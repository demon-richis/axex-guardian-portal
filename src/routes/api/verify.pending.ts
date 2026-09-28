import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

const Id = z.string().min(1).max(40);

export const Route = createFileRoute("/api/verify/pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { hasBotApiAccess } = await import("@/lib/api-auth.server");
        if (!hasBotApiAccess(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const userId = Id.safeParse(url.searchParams.get("userId"));
        const guildId = Id.safeParse(url.searchParams.get("guildId"));
        if (!userId.success || !guildId.success) {
          return Response.json({ error: "Missing or invalid userId or guildId" }, { status: 400 });
        }

        try {
          const { verifyTokens } = await import("@/lib/db/schema");
          const { getDb } = await import("@/lib/db/client.server");
          const existing = await getDb()
            .select({ token: verifyTokens.token })
            .from(verifyTokens)
            .where(
              and(
                eq(verifyTokens.userId, userId.data),
                eq(verifyTokens.guildId, guildId.data),
                eq(verifyTokens.used, false),
                gt(verifyTokens.expiresAt, new Date()),
              ),
            )
            .orderBy(desc(verifyTokens.createdAt))
            .limit(1);

          return Response.json({ token: existing[0]?.token ?? null });
        } catch (error) {
          console.error("[verify/pending] Error:", error);
          return Response.json({ token: null }, { status: 500 });
        }
      },
    },
  },
});
