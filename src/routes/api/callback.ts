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
        const { token, passed } = parsed.data;
        try {
          const db = getDb();
          const row = (
            await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
          )[0];
          if (!row || row.used || row.expiresAt.getTime() < Date.now() || !row.discordId) {
            console.error("[callback] Token missing, expired, used, or lacks OAuth identity");
            return Response.json({ success: false }, { status: 400 });
          }
          const serverIp = clientIp(request);
          const submittedIp = parsed.data.ipAddress?.trim() ?? "";
          const observedIp = serverIp || submittedIp;
          const ip = await checkIp(observedIp);
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
              attempts,
              discordTag: parsed.data.discordTag ?? row.discordTag ?? row.discordUsername,
              discordAvatar: parsed.data.discordAvatar ?? row.discordAvatar,
              ipAddress: observedIp || null,
              vpnDetected,
              vpnType,
              flagged,
              flagReason: reason,
              completedAt: finalPassed ? new Date() : null,
            })
            .where(and(eq(verifyTokens.token, token), eq(verifyTokens.used, false)));
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
