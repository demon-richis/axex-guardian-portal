import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
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
          return Response.json({ error: "Missing or invalid userId or guildId" }, { status: 400 });
        }

        try {
          const { verificationState, verifyTokens } = await import("@/lib/db/schema");
          const { getDb } = await import("@/lib/db/client.server");
          const db = getDb();
          const state = (
            await db
              .select()
              .from(verificationState)
              .where(
                and(
                  eq(verificationState.userId, userId.data),
                  eq(verificationState.guildId, guildId.data),
                ),
              )
              .limit(1)
          )[0];
          const existing = await db
            .select({
              token: verifyTokens.token,
              status: verifyTokens.status,
              failureReason: verifyTokens.failureReason,
              expiresAt: verifyTokens.expiresAt,
              referenceId: verifyTokens.referenceId,
            })
            .from(verifyTokens)
            .where(
              and(
                eq(verifyTokens.userId, userId.data),
                eq(verifyTokens.guildId, guildId.data),
                inArray(verifyTokens.status, ["pending", "bot_update_pending"]),
              ),
            )
            .orderBy(desc(verifyTokens.createdAt))
            .limit(1);

          const row = existing[0];
          const attempts = state?.attempts ?? 0;
          const locked = Boolean(state?.lockedAt) || attempts >= 3;
          const coolingDown = Boolean(
            state?.cooldownUntil && state.cooldownUntil.getTime() > Date.now(),
          );
          const token =
            row && row.expiresAt.getTime() > Date.now() && !locked && !coolingDown
              ? row.token
              : null;
          console.log("[verify/pending] Result:", {
            state: locked ? "locked" : coolingDown ? "cooldown" : token ? "found" : "not found",
            attempts,
          });
          return Response.json({
            token,
            status: row?.status ?? null,
            attempts,
            locked,
            cooldownUntil: state?.cooldownUntil?.toISOString() ?? null,
            failureReason: row?.failureReason ?? null,
            referenceId: state?.lastReferenceId ?? row?.referenceId ?? null,
          });
        } catch (error) {
          console.error("[verify/pending] Error:", error instanceof Error ? error.name : "unknown");
          return Response.json({ token: null }, { status: 500 });
        }
      },
    },
  },
});
