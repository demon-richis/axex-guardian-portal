import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/verify/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        console.log("[verify/token] Looking up token:", `${params.token.slice(0, 8)}…`);
        const { getDb, snowflakeToDate } = await import("@/lib/db/client.server");
        const { verifyTokens } = await import("@/lib/db/schema");
        try {
          const token = params.token.slice(0, 200);
          const rows = await getDb()
            .select()
            .from(verifyTokens)
            .where(eq(verifyTokens.token, token))
            .limit(1);
          const row = rows[0];
          if (!row) {
            const result = { valid: false, reason: "invalid" } as const;
            console.log("[verify/token] Result:", result);
            return Response.json(result);
          }
          if (row.status === "locked" || (row.attempts ?? 0) >= 3) {
            const result = {
              valid: false,
              reason: "lockout",
              attempts: row.attempts,
              failureReason: row.failureReason,
              referenceId: row.referenceId,
            } as const;
            console.log("[verify/token] Result:", result);
            return Response.json(result);
          }
          if (row.cooldownUntil && row.cooldownUntil.getTime() > Date.now()) {
            const result = {
              valid: false,
              reason: "cooldown",
              attempts: row.attempts,
              cooldownUntil: row.cooldownUntil.toISOString(),
              failureReason: row.failureReason,
              referenceId: row.referenceId,
            } as const;
            console.log("[verify/token] Result:", result);
            return Response.json(result);
          }
          if (row.used && !["completed", "bot_update_pending"].includes(row.status)) {
            const result = { valid: false, reason: "used" } as const;
            console.log("[verify/token] Result:", result);
            return Response.json(result);
          }
          if (row.expiresAt.getTime() < Date.now()) {
            const result = { valid: false, reason: "expired" } as const;
            console.log("[verify/token] Result:", result);
            return Response.json(result);
          }
          const result = {
            valid: true,
            userId: row.userId,
            guildId: row.guildId,
            guildName: row.guildName,
            guildMemberCount: row.guildMemberCount ?? 0,
            expiresAt: row.expiresAt.toISOString(),
            status: row.status,
            referenceId: row.referenceId,
            attempts: row.attempts,
            cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
            failureReason: row.failureReason,
            botAcknowledged: Boolean(row.botAcknowledgedAt),
            botError: row.botError,
            used: row.used,
            discordUser: row.discordId
              ? {
                  id: row.discordId,
                  username: row.discordUsername,
                  avatar: row.discordAvatar,
                  createdAt: snowflakeToDate(row.discordId).toISOString(),
                }
              : null,
          };
          console.log("[verify/token] Result:", { valid: result.valid, guildId: result.guildId });
          return Response.json(result);
        } catch (e) {
          console.error("[verify/token] Lookup failed:", e);
          return Response.json({ valid: false, reason: "error" }, { status: 500 });
        }
      },
    },
  },
});
