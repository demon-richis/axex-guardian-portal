import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

const Body = z.object({
  token: z.string().min(1).max(200),
  event: z.enum([
    "page_opened",
    "oauth_started",
    "oauth_completed",
    "network_clear",
    "network_blocked",
    "network_unavailable",
    "captcha_passed",
    "captcha_failed",
    "callback_sent",
    "callback_failed",
    "verification_completed",
    "verification_error",
  ]),
  device: z.enum(["mobile", "desktop", "unknown"]).optional(),
});

const intelligenceEvents: Record<string, string> = {
  page_opened: "VERIFY_START",
  oauth_started: "OAUTH_STARTED",
  oauth_completed: "OAUTH_COMPLETED",
  network_clear: "NETWORK_CLEAR",
  network_blocked: "NETWORK_BLOCKED",
  network_unavailable: "NETWORK_UNAVAILABLE",
  captcha_passed: "CHALLENGE_PASSED",
  captcha_failed: "CHALLENGE_FAIL",
  callback_sent: "CALLBACK_SENT",
  callback_failed: "CALLBACK_FAILED",
  verification_completed: "PORTAL_COMPLETED",
  verification_error: "PORTAL_ERROR",
};

export const Route = createFileRoute("/api/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isSameOrigin, consumeConfiguredRateLimit } =
          await import("@/lib/rate-limit.server");
        if (!isSameOrigin(request)) {
          return Response.json({ success: false, error: "cross_origin_request" }, { status: 403 });
        }
        const [{ getDb, clientIp }, { auditLogs, verifyTokens }] = await Promise.all([
          import("@/lib/db/client.server"),
          import("@/lib/db/schema"),
        ]);
        let db;
        let requestLimit;
        try {
          db = getDb();
          const ip = clientIp(request) || "unknown";
          requestLimit = await consumeConfiguredRateLimit(db, `telemetry:ip:${ip}`, 60, 60_000);
        } catch (error) {
          console.error(
            "[telemetry] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false }, { status: 503 });
        }
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
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ success: false }, { status: 400 });
        const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
        try {
          const tokenLimit = await consumeConfiguredRateLimit(
            db,
            `telemetry:token:${tokenHash}`,
            40,
            60 * 60_000,
          );
          if (!tokenLimit.allowed) {
            return Response.json(
              { success: false, error: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
            );
          }
        } catch (error) {
          console.error(
            "[telemetry] Token limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false }, { status: 503 });
        }
        try {
          const { analyzePortalUser, notifyBotIntelligence, recordPortalEvent } =
            await import("@/lib/intelligence.server");
          const row = (
            await db
              .select({
                userId: verifyTokens.userId,
                guildId: verifyTokens.guildId,
                referenceId: verifyTokens.referenceId,
                discordId: verifyTokens.discordId,
                discordUsername: verifyTokens.discordUsername,
                discordAvatar: verifyTokens.discordAvatar,
              })
              .from(verifyTokens)
              .where(eq(verifyTokens.token, parsed.data.token))
              .limit(1)
          )[0];
          if (!row) return Response.json({ success: false }, { status: 404 });
          await db.insert(auditLogs).values({
            guildId: row.guildId,
            eventType: `UX_${parsed.data.event.toUpperCase()}`,
            severity: "info",
            metadata: { device: parsed.data.device ?? "unknown", referenceId: row.referenceId },
          });

          const eventType = intelligenceEvents[parsed.data.event];
          const userId = row.discordId ?? row.userId;
          if (eventType && userId) {
            await recordPortalEvent({
              userId,
              guildId: row.guildId,
              eventType,
              metadata: {
                device: parsed.data.device ?? "unknown",
                referenceId: row.referenceId,
                source: "guardian_portal",
              },
            });
          }
          if (parsed.data.event === "page_opened" || parsed.data.event === "oauth_completed") {
            const analysis = await analyzePortalUser(userId, row.guildId, {
              username: row.discordUsername,
              avatar: row.discordAvatar,
            });
            if (analysis) {
              await notifyBotIntelligence(userId, row.guildId, analysis, parsed.data.event);
            }
          }
          return Response.json({ success: true });
        } catch (error) {
          console.error("[telemetry] Failed:", error instanceof Error ? error.name : "unknown");
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
