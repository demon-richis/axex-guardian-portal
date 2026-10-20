import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  guildId: z.string().min(1).max(40),
  userId: z.string().min(1).max(40),
});

export const Route = createFileRoute("/api/bot/release")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
        try {
          const { getDb } = await import("@/lib/db/client.server");
          const { auditLogs } = await import("@/lib/db/schema");
          const { releaseVerificationState } = await import("@/lib/verification-state.server");
          const db = getDb();
          await releaseVerificationState(db, parsed.data.guildId, parsed.data.userId);
          await db.insert(auditLogs).values({
            guildId: parsed.data.guildId,
            userId: parsed.data.userId,
            eventType: "STATE_RELEASED",
            severity: "info",
            flagged: false,
            metadata: { source: "bot_release" },
          });
          return Response.json({
            success: true,
            guildId: parsed.data.guildId,
            userId: parsed.data.userId,
          });
        } catch (error) {
          console.error(
            "[bot/release] Request failed:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
