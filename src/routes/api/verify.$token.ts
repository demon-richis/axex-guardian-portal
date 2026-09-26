import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/verify/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getDb, snowflakeToDate } = await import("@/lib/db/client.server");
        const { verifyTokens } = await import("@/lib/db/schema");
        try {
          const token = params.token.slice(0, 200);
          const rows = await getDb().select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1);
          const row = rows[0];
          if (!row) return Response.json({ valid: false, reason: "invalid" });
          if (row.used) return Response.json({ valid: false, reason: "used" });
          if (row.expiresAt.getTime() < Date.now()) return Response.json({ valid: false, reason: "expired" });
          return Response.json({
            valid: true,
            userId: row.userId,
            guildId: row.guildId,
            guildName: row.guildName,
            guildMemberCount: row.guildMemberCount ?? 0,
            expiresAt: row.expiresAt.toISOString(),
            used: false,
            discordUser: row.discordId
              ? {
                  id: row.discordId,
                  username: row.discordUsername,
                  avatar: row.discordAvatar,
                  createdAt: snowflakeToDate(row.discordId).toISOString(),
                }
              : null,
          });
        } catch (e) {
          console.error(e);
          return Response.json({ valid: false, reason: "error" }, { status: 500 });
        }
      },
    },
  },
});
