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
            .select({
              token: verifyTokens.token,
              status: verifyTokens.status,
              attempts: verifyTokens.attempts,
              cooldownUntil: verifyTokens.cooldownUntil,
              failureReason: verifyTokens.failureReason,
              expiresAt: verifyTokens.expiresAt,
            })
            .from(verifyTokens)
            .where(
              and(
                eq(verifyTokens.userId, userId.data),
                eq(verifyTokens.guildId, guildId.data),
                gt(verifyTokens.expiresAt, new Date()),
              ),
            )
            .orderBy(desc(verifyTokens.createdAt))
            .limit(1);

          const row = existing[0];
          const locked = row?.status === "locked" || (row?.attempts ?? 0) >= 3;
          const coolingDown = Boolean(
            row?.cooldownUntil && row.cooldownUntil.getTime() > Date.now(),
          );
          const token =
            row && !locked && !coolingDown && row.status !== "completed" ? row.token : null;
          console.log("[verify/pending] Result:", {
            state: locked ? "locked" : coolingDown ? "cooldown" : token ? "found" : "not found",
            attempts: row?.attempts ?? 0,
          });
          return Response.json({
            token,
            status: row?.status ?? null,
            attempts: row?.attempts ?? 0,
            locked,
            cooldownUntil: row?.cooldownUntil?.toISOString() ?? null,
            failureReason: row?.failureReason ?? null,
          });
        } catch (error) {
          console.error("[verify/pending] Error:", error);
          return Response.json({ token: null }, { status: 500 });
        }
      },
    },
  },
});
