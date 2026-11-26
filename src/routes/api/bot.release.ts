import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  guildId: z.string().min(1).max(40),
  userId: z.string().min(1).max(40),
  reviewAction: z.enum(["approve", "deny", "ban"]).optional(),
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
          const { auditLogs, verifyTokens } = await import("@/lib/db/schema");
          const { releaseVerificationState } = await import("@/lib/verification-state.server");
          const db = getDb();
          if (!parsed.data.reviewAction || parsed.data.reviewAction === "approve") {
            await releaseVerificationState(db, parsed.data.guildId, parsed.data.userId);
          }
          if (parsed.data.reviewAction) {
            const approved = parsed.data.reviewAction === "approve";
            await db
              .update(verifyTokens)
              .set({
                status: approved ? "completed" : "locked",
                used: true,
                completedAt: approved ? new Date() : null,
                failureReason: approved ? null : `Manual review ${parsed.data.reviewAction}`,
                botError: null,
              })
              .where(
                and(
                  eq(verifyTokens.guildId, parsed.data.guildId),
                  eq(verifyTokens.userId, parsed.data.userId),
                  eq(verifyTokens.status, "pending_review"),
                ),
              );
          }
          await db.insert(auditLogs).values({
            guildId: parsed.data.guildId,
            userId: parsed.data.userId,
            eventType: parsed.data.reviewAction ? "MANUAL_REVIEW_RESOLVED" : "STATE_RELEASED",
            severity: "info",
            flagged: false,
            metadata: {
              source: "bot_release",
              ...(parsed.data.reviewAction ? { reviewAction: parsed.data.reviewAction } : {}),
            },
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
