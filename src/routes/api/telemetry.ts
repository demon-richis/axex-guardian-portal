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

export const Route = createFileRoute("/api/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ success: false }, { status: 400 });
        try {
          const { getDb } = await import("@/lib/db/client.server");
          const { auditLogs, verifyTokens } = await import("@/lib/db/schema");
          const row = (
            await getDb()
              .select({ guildId: verifyTokens.guildId, referenceId: verifyTokens.referenceId })
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
          return Response.json({ success: true });
        } catch (error) {
          console.error("[telemetry] Failed:", error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
