import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

const Id = z.string().min(1).max(40);

export const Route = createFileRoute("/api/verify/pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[verify/pending] Request received");
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;

        const url = new URL(request.url);
        const userId = Id.safeParse(url.searchParams.get("userId"));
        const guildId = Id.safeParse(url.searchParams.get("guildId"));
        if (!userId.success || !guildId.success) {
          console.error("[verify/pending] Missing or invalid userId/guildId");
          return Response.json({ error: "Missing or invalid userId or guildId" }, { status: 400 });
        }
        console.log("[verify/pending] Checking for userId:", userId.data);

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

          const token = existing[0]?.token ?? null;
          console.log("[verify/pending] Result:", token ? "found" : "not found");
          return Response.json({ token });
        } catch (error) {
          console.error("[verify/pending] Error:", error);
          return Response.json({ token: null }, { status: 500 });
        }
      },
    },
  },
});
