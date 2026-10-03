import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
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
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ success: false }, { status: 400 });
        try {
          const { getDb } = await import("@/lib/db/client.server");
          const { auditLogs, verifyTokens } = await import("@/lib/db/schema");
          const { analyzePortalUser, notifyBotIntelligence, recordPortalEvent } =
            await import("@/lib/intelligence.server");
          const row = (
            await getDb()
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
          await getDb()
            .insert(auditLogs)
            .values({
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
          console.error("[telemetry] Failed:", error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
