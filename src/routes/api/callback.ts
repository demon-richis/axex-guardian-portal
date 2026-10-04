import { createFileRoute } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

const inFlightCallbacks = new Set<string>();

const Body = z.object({
  token: z.string().min(1).max(200),
  discordId: z.string().max(40).optional(),
  discordTag: z.string().max(100).optional(),
  discordAvatar: z.string().max(200).nullable().optional(),
  passed: z.boolean(),
  vpnDetected: z.boolean().optional(),
  vpnType: z.string().max(100).nullable().optional(),
  ipAddress: z.string().max(100).nullable().optional(),
  accountAgeDays: z.number().int().nonnegative().optional(),
  clickMs: z.number().int().nonnegative().optional(),
  flagged: z.boolean().optional(),
  flagReason: z.string().max(500).nullable().optional(),
  failureReason: z.enum(["WRONG_ANSWER", "TIMEOUT", "BOT_DETECTED", "VPN_BLOCKED"]).optional(),
  timeout: z.boolean().optional(),
  attempts: z.number().int().positive().optional(),
});

export const Route = createFileRoute("/api/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[callback] Verification result received");
        const { isSameOrigin, rateLimit, requestAddress } = await import("@/lib/rate-limit.server");
        if (!isSameOrigin(request)) {
          return Response.json({ success: false, error: "cross_origin_request" }, { status: 403 });
        }
        const requestLimit = rateLimit(`callback:${requestAddress(request)}`, 12, 60_000);
        if (!requestLimit.allowed) {
          return Response.json(
            {
              success: false,
              error: "rate_limited",
              retryAfterSeconds: requestLimit.retryAfterSeconds,
            },
            { status: 429, headers: { "Retry-After": String(requestLimit.retryAfterSeconds) } },
          );
        }
        const { getDb, snowflakeToDate, checkIp, clientIp } =
          await import("@/lib/db/client.server");
        const { auditLogs, suspiciousAttempts, verifyTokens } = await import("@/lib/db/schema");
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          console.error("[callback] Invalid request body");
          return Response.json({ success: false }, { status: 400 });
        }
        const { token, discordId, discordTag, discordAvatar, passed } = parsed.data;
        if (inFlightCallbacks.has(token)) {
          return Response.json(
            { success: false, error: "verification_in_progress" },
            { status: 409 },
          );
        }
        inFlightCallbacks.add(token);
        try {
          const db = getDb();
          const row = (
            await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
          )[0];
          if (row?.used && row.status === "completed") {
            return Response.json({
              success: true,
              passed: true,
              status: row.status,
              referenceId: row.referenceId,
              idempotent: true,
            });
          }
          if (!row || row.used || row.expiresAt.getTime() < Date.now() || !row.discordId) {
            console.error("[callback] Token missing, expired, used, or lacks OAuth identity");
            return Response.json({ success: false }, { status: 400 });
          }
          if (discordId && discordId !== row.discordId) {
            console.warn("[callback] Discord identity mismatch for verification token");
            return Response.json({ success: false, error: "identity_mismatch" }, { status: 403 });
          }
          if (row.status === "locked" || (row.attempts ?? 0) >= 3) {
            return Response.json(
              {
                success: false,
                error: "attempts_exhausted",
                attempts: row.attempts,
                referenceId: row.referenceId,
              },
              { status: 429 },
            );
          }
          if (row.cooldownUntil && row.cooldownUntil.getTime() > Date.now()) {
            return Response.json(
              {
                success: false,
                error: "cooldown",
                attempts: row.attempts,
                cooldownUntil: row.cooldownUntil.toISOString(),
                failureReason: row.failureReason,
                referenceId: row.referenceId,
              },
              { status: 429 },
            );
          }
          const serverIp = clientIp(request);
          const submittedIp = parsed.data.ipAddress?.trim() ?? "";
          const observedIp = serverIp || submittedIp;
          const ip = await checkIp(observedIp);
          if (ip.status === "unavailable") {
            console.error("[callback] Network security check unavailable; refusing verification");
            return Response.json(
              {
                success: false,
                error: "network_check_unavailable",
                referenceId: row.referenceId,
              },
              { status: 503 },
            );
          }
          const vpnDetected = ip.isVPN || parsed.data.vpnDetected === true;
          const vpnType = ip.type ?? parsed.data.vpnType ?? null;
          const accountAgeDays = Math.floor(
            (Date.now() - snowflakeToDate(row.discordId).getTime()) / 86400000,
          );
          const clickMs = parsed.data.clickMs ?? null;
          const attempts = (row.attempts ?? 0) + 1;
          const sameIpUsers = observedIp
            ? Number(
                (
                  await db.execute(
                    sql`select count(distinct ${auditLogs.userId}) as count from ${auditLogs} where ${auditLogs.guildId} = ${row.guildId} and ${auditLogs.ipAddress} = ${observedIp}`,
                  )
                ).rows[0]?.["count"] ?? 0,
              )
            : 0;
          const automaticReason = vpnDetected
            ? "VPN or proxy detected"
            : accountAgeDays < 3
              ? "New Discord account"
              : clickMs !== null && clickMs < 800
                ? "Unusually fast response"
                : clickMs !== null && clickMs > 58000
                  ? "Response near timeout"
                  : attempts >= 2
                    ? "Repeated verification attempt"
                    : sameIpUsers >= 3
                      ? "Shared IP used by multiple users"
                      : null;
          const flagged = Boolean(parsed.data.flagged || automaticReason);
          const event: "VERIFIED" | "VPN_BLOCKED" | "BOT_DETECTED" | "WRONG_ANSWER" | "TIMEOUT" =
            passed
              ? "VERIFIED"
              : vpnDetected
                ? "VPN_BLOCKED"
                : parsed.data.timeout || (clickMs !== null && clickMs > 58000)
                  ? "TIMEOUT"
                  : clickMs !== null && clickMs < 1500
                    ? "BOT_DETECTED"
                    : "WRONG_ANSWER";
          const reason =
            parsed.data.flagReason ??
            automaticReason ??
            (event === "WRONG_ANSWER"
              ? "Wrong answer"
              : event === "TIMEOUT"
                ? "Verification timed out"
                : event === "BOT_DETECTED"
                  ? "Suspiciously fast response"
                  : event === "VPN_BLOCKED"
                    ? "VPN or proxy detected"
                    : null);
          const finalPassed = passed && !vpnDetected && accountAgeDays >= 3;
          const nextAttempts = attempts;
          const cooldownUntil = finalPassed
            ? null
            : nextAttempts === 1
              ? new Date(Date.now() + 3 * 60 * 1000)
              : nextAttempts === 2
                ? new Date(Date.now() + 3 * 60 * 60 * 1000)
                : null;
          const locked = !finalPassed && nextAttempts >= 3;
          const suspicious = flagged
            ? await db
                .insert(suspiciousAttempts)
                .values({
                  guildId: row.guildId,
                  userId: row.discordId,
                  discordTag: parsed.data.discordTag ?? row.discordTag ?? row.discordUsername,
                  ipAddress: observedIp || null,
                  vpnType,
                  accountAgeDays,
                  clickMs,
                  reason,
                })
                .onConflictDoUpdate({
                  target: [suspiciousAttempts.guildId, suspiciousAttempts.userId],
                  set: {
                    attemptCount: sql`${suspiciousAttempts.attemptCount} + 1`,
                    lastAttemptAt: new Date(),
                    ipAddress: observedIp || null,
                    vpnType,
                    accountAgeDays,
                    clickMs,
                    reason,
                  },
                })
                .returning({ attemptCount: suspiciousAttempts.attemptCount })
            : [];
          const suspiciousCount = suspicious[0]?.attemptCount ?? 0;
          const autoBanned = suspiciousCount >= 3;
          if (autoBanned) {
            await db
              .update(suspiciousAttempts)
              .set({ autoBanned: true })
              .where(
                and(
                  eq(suspiciousAttempts.guildId, row.guildId),
                  eq(suspiciousAttempts.userId, row.discordId),
                ),
              );
          }
          console.log("[callback] Decision:", {
            passed: finalPassed,
            flagged,
            autoBanned,
            attempts,
            event,
          });
          await db
            .update(verifyTokens)
            .set({
              used: finalPassed || locked,
              status: finalPassed
                ? "bot_update_pending"
                : locked
                  ? "locked"
                  : vpnDetected
                    ? "blocked"
                    : "failed",
              attempts,
              cooldownUntil,
              failureReason: parsed.data.failureReason ?? event,
              discordTag: discordTag ?? row.discordTag ?? row.discordUsername,
              discordAvatar: discordAvatar ?? row.discordAvatar,
              ipAddress: observedIp || null,
              vpnDetected,
              vpnType,
              flagged,
              flagReason: reason,
              completedAt: finalPassed ? new Date() : null,
              botError: null,
            })
            .where(and(eq(verifyTokens.token, token), eq(verifyTokens.used, false)));
          const botWebhookUrl = process.env["BOT_WEBHOOK_URL"];
          let callbackStatus: "completed" | "bot_update_pending" | "blocked" | "failed" | "locked" =
            finalPassed
              ? "bot_update_pending"
              : locked
                ? "locked"
                : vpnDetected
                  ? "blocked"
                  : "failed";
          if (!botWebhookUrl) {
            console.error("[callback] BOT_WEBHOOK_URL is not configured");
            await db
              .update(verifyTokens)
              .set({ status: callbackStatus, botError: "BOT_WEBHOOK_URL is not configured" })
              .where(eq(verifyTokens.token, token));
          } else {
            const botPayload = {
              guildId: row.guildId,
              referenceId: row.referenceId,
              userId: row.discordId,
              discordId: discordId ?? row.discordId,
              discordTag: discordTag ?? row.discordTag ?? row.discordUsername,
              discordAvatar: discordAvatar ?? row.discordAvatar,
              passed: finalPassed,
              vpnDetected,
              vpnType,
              accountAgeDays,
              clickMs,
              flagged,
              flagReason: reason,
              attempts,
              cooldownUntil: cooldownUntil?.toISOString() ?? null,
              failureReason: parsed.data.failureReason ?? event,
              locked,
            };
            try {
              console.log("[callback] Sending result to bot callback");
              const res = await fetch(botWebhookUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": process.env["AXEX_BOT_API_KEY"] ?? "",
                },
                body: JSON.stringify(botPayload),
              });
              console.log("[callback] Bot webhook response:", res.status);
              if (!res.ok) {
                console.error("[callback] Bot webhook returned an error status:", res.status);
                await db
                  .update(verifyTokens)
                  .set({
                    status: finalPassed
                      ? "bot_update_pending"
                      : locked
                        ? "locked"
                        : vpnDetected
                          ? "blocked"
                          : "failed",
                    botError: `Bot returned ${res.status}`,
                  })
                  .where(eq(verifyTokens.token, token));
              } else {
                callbackStatus = finalPassed
                  ? "completed"
                  : locked
                    ? "locked"
                    : vpnDetected
                      ? "blocked"
                      : "failed";
                await db
                  .update(verifyTokens)
                  .set({ status: callbackStatus, botAcknowledgedAt: new Date(), botError: null })
                  .where(eq(verifyTokens.token, token));
              }
            } catch (error) {
              console.error("[callback] Bot webhook call failed:", error);
              await db
                .update(verifyTokens)
                .set({
                  status: finalPassed
                    ? "bot_update_pending"
                    : locked
                      ? "locked"
                      : vpnDetected
                        ? "blocked"
                        : "failed",
                  botError:
                    error instanceof Error ? error.message.slice(0, 500) : "Bot callback failed",
                })
                .where(eq(verifyTokens.token, token));
            }
          }
          const severity = autoBanned ? "critical" : flagged ? "warn" : "info";
          await db.insert(auditLogs).values({
            guildId: row.guildId,
            userId: row.discordId,
            discordTag: parsed.data.discordTag ?? row.discordTag ?? row.discordUsername,
            eventType: autoBanned ? "AUTO_BANNED" : event,
            severity,
            ipAddress: observedIp || null,
            vpnDetected,
            accountAgeDays,
            clickMs,
            flagged,
            flagReason: reason,
            metadata: { attempts, passed: finalPassed, clientIp: submittedIp || null },
          });
          return Response.json({
            success: true,
            passed: finalPassed,
            status: callbackStatus,
            referenceId: row.referenceId,
            flagged,
            autoBanned,
            attempts,
          });
        } catch (e) {
          console.error("[callback] Failed to process verification:", e);
          return Response.json({ success: false }, { status: 500 });
        } finally {
          inFlightCallbacks.delete(token);
        }
      },
    },
  },
});
