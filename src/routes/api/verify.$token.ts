import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/verify/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = params.token.slice(0, 200);
        try {
          const [{ getDb, clientIp, snowflakeToDate }, { verificationState, verifyTokens }] =
            await Promise.all([import("@/lib/db/client.server"), import("@/lib/db/schema")]);
          const [
            { consumeConfiguredRateLimit, PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE },
            { verifySession },
          ] = await Promise.all([
            import("@/lib/rate-limit.server"),
            import("@/lib/session.server"),
          ]);
          const { publicVerificationSummary } = await import("@/lib/verification-response.server");
          const db = getDb();
          const ip = clientIp(request) || "unknown";
          const ipLimit = await consumeConfiguredRateLimit(
            db,
            `verify:ip:${ip}`,
            PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE,
            60_000,
          );
          if (!ipLimit.allowed) {
            return Response.json(
              { valid: false, reason: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
            );
          }
          const tokenHash = createHash("sha256").update(token).digest("hex");
          const tokenLimit = await consumeConfiguredRateLimit(
            db,
            `verify:token:${tokenHash}`,
            PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE,
            60_000,
          );
          if (!tokenLimit.allowed) {
            return Response.json(
              { valid: false, reason: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
            );
          }

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
          const sessionMatches = Boolean(
            row.discordId && verifySession(request, token, row.discordId),
          );
          const common = publicVerificationSummary(row, attempts, sessionMatches, snowflakeToDate);
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
              referenceId: state?.lastReferenceId ?? row.referenceId,
            });
          }
          if (state?.cooldownUntil && state.cooldownUntil.getTime() > Date.now()) {
            return Response.json({
              valid: false,
              reason: "cooldown",
              attempts,
              cooldownUntil: state.cooldownUntil.toISOString(),
              failureReason: row.failureReason,
              referenceId: state.lastReferenceId ?? row.referenceId,
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
          return Response.json({ valid: false, reason: "error" }, { status: 503 });
        }
      },
    },
  },
});
