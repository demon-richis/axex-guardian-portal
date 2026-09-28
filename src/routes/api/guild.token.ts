import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  token: z.string().min(1).max(200),
  userId: z.string().min(1).max(40),
  guildId: z.string().min(1).max(40),
  guildName: z.string().max(200).optional(),
  guildMemberCount: z.number().int().nonnegative().optional(),
  expiresAt: z.string().datetime({ offset: true }),
});

export const Route = createFileRoute("/api/guild/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { hasBotApiAccess } = await import("@/lib/api-auth.server");
        if (!hasBotApiAccess(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Missing or invalid required fields" }, { status: 400 });

        try {
          const { verifyTokens } = await import("@/lib/db/schema");
          const { getDb } = await import("@/lib/db/client.server");
          const { token, userId, guildId, guildName, guildMemberCount, expiresAt } = parsed.data;

          await getDb()
            .insert(verifyTokens)
            .values({
              token,
              userId,
              guildId,
              guildName: guildName || "Unknown",
              guildMemberCount: guildMemberCount || 0,
              expiresAt: new Date(expiresAt),
              used: false,
            })
            .onConflictDoNothing();

          return Response.json({ success: true, token });
        } catch (error) {
          console.error("[guild/token] Error:", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
