import { createFileRoute } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

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
  timeout: z.boolean().optional(),
  attempts: z.number().int().positive().optional(),
});

export const Route = createFileRoute("/api/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[callback] Verification result received");
        const { getDb, snowflakeToDate, checkIp, clientIp } =
          await import("@/lib/db/client.server");
        const { auditLogs, guildConfigs, suspiciousAttempts, verifyTokens } =
          await import("@/lib/db/schema");
        const { postWebhook } = await import("@/lib/webhook.server");
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          console.error("[callback] Invalid request body");
          return Response.json({ success: false }, { status: 400 });
        }
        const { token, discordId, discordTag, discordAvatar, passed } = parsed.data;
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
          const reason = parsed.data.flagReason ?? automaticReason;
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
          const finalPassed = passed && !vpnDetected && accountAgeDays >= 3;
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
              used: finalPassed,
              status: finalPassed ? "bot_update_pending" : vpnDetected ? "blocked" : "failed",
              attempts,
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
          let callbackStatus: "completed" | "bot_update_pending" | "blocked" | "failed" =
            finalPassed ? "bot_update_pending" : vpnDetected ? "blocked" : "failed";
          if (!botWebhookUrl) {
            console.error("[callback] BOT_WEBHOOK_URL is not configured");
            await db
              .update(verifyTokens)
              .set({ status: callbackStatus, botError: "BOT_WEBHOOK_URL is not configured" })
              .where(eq(verifyTokens.token, token));
          } else {
            const botPayload = {
              guildId: row.guildId,
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
            };
            try {
              console.log("[callback] Sending result to bot:", botWebhookUrl);
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
                    status: finalPassed ? "bot_update_pending" : vpnDetected ? "blocked" : "failed",
                    botError: `Bot returned ${res.status}`,
                  })
                  .where(eq(verifyTokens.token, token));
              } else {
                callbackStatus = finalPassed ? "completed" : vpnDetected ? "blocked" : "failed";
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
                  status: finalPassed ? "bot_update_pending" : vpnDetected ? "blocked" : "failed",
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
          const config = (
            await db
              .select()
              .from(guildConfigs)
              .where(eq(guildConfigs.guildId, row.guildId))
              .limit(1)
          )[0];
          if (config) {
            const data = {
              user: row.discordTag ?? row.discordUsername ?? row.discordId,
              id: row.discordId,
              accountAgeDays,
              clickMs,
              ip: observedIp || null,
              vpnType,
              verdict: finalPassed ? "VERIFIED" : (reason ?? event),
              guildName: config.guildName,
              reason,
            };
            await postWebhook(config.webhookUrl, autoBanned ? "AUTO_BANNED" : event, data);
            if (flagged) await postWebhook(config.webhookUrl, "SUSPICIOUS", data);
          }
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
        }
      },
    },
  },
});
