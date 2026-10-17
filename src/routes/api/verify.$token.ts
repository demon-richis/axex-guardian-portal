import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

export const Route = createFileRoute("/api/verify/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getDb, snowflakeToDate } = await import("@/lib/db/client.server");
        const { verificationState, verifyTokens } = await import("@/lib/db/schema");
        try {
          const token = params.token.slice(0, 200);
          const db = getDb();
          const row = (
            await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
          )[0];
          if (!row) return Response.json({ valid: false, reason: "invalid" });
          const state = (
            await db
              .select()
              .from(verificationState)
              .where(
                and(
                  eq(verificationState.guildId, row.guildId),
                  eq(verificationState.userId, row.userId),
                ),
              )
              .limit(1)
          )[0];
          const attempts = state?.attempts ?? row.attempts;
          const discordUser = row.discordId
            ? {
                id: row.discordId,
                username: row.discordUsername,
                avatar: row.discordAvatar,
                createdAt: snowflakeToDate(row.discordId).toISOString(),
              }
            : null;
          const common = {
            userId: row.userId,
            guildId: row.guildId,
            guildName: row.guildName,
            guildMemberCount: row.guildMemberCount ?? 0,
            expiresAt: row.expiresAt.toISOString(),
            status: row.status,
            referenceId: row.referenceId,
            attempts,
            failureReason: row.failureReason,
            botAcknowledged: Boolean(row.botAcknowledgedAt),
            botError: row.botError,
            used: row.used,
            discordUser,
          };
          if (row.status === "completed")
            return Response.json({ valid: true, completed: true, ...common });
          if (row.status === "bot_update_pending") {
            return Response.json({
              valid: true,
              pendingPassed: Boolean(row.completedAt),
              ...common,
            });
          }
          if (row.status === "locked" || state?.lockedAt || attempts >= 3) {
            return Response.json({
              valid: false,
              reason: "lockout",
              attempts,
              failureReason: row.failureReason,
              referenceId: row.referenceId,
            });
          }
          if (state?.cooldownUntil && state.cooldownUntil.getTime() > Date.now()) {
            return Response.json({
              valid: false,
              reason: "cooldown",
              attempts,
              cooldownUntil: state.cooldownUntil.toISOString(),
              failureReason: row.failureReason,
              referenceId: row.referenceId,
            });
          }
          if (row.used) return Response.json({ valid: false, reason: "used" });
          if (row.expiresAt.getTime() < Date.now())
            return Response.json({ valid: false, reason: "expired" });
          return Response.json({
            valid: true,
            ...common,
            cooldownUntil: state?.cooldownUntil?.toISOString() ?? null,
          });
        } catch (error) {
          console.error(
            "[verify/token] Lookup failed:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ valid: false, reason: "error" }, { status: 500 });
        }
      },
    },
  },
});
