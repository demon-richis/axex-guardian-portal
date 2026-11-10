import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/check-ip")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [
            { clientIp, getDb },
            { verifyTokens },
            { checkIpCached },
            { consumeConfiguredRateLimit },
          ] = await Promise.all([
            import("@/lib/db/client.server"),
            import("@/lib/db/schema"),
            import("@/lib/ip-check-cache.server"),
            import("@/lib/rate-limit.server"),
          ]);
          const url = new URL(request.url);
          const token = url.searchParams.get("token") ?? "";
          if (!token || token.length > 200) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "invalid_request" },
              { status: 400 },
            );
          }
          const db = getDb();
          const now = new Date();
          const tokenRow = (
            await db
              .select({ userId: verifyTokens.userId, discordId: verifyTokens.discordId, used: verifyTokens.used, expiresAt: verifyTokens.expiresAt, status: verifyTokens.status })
              .from(verifyTokens)
              .where(eq(verifyTokens.token, token))
              .limit(1)
          )[0];
          if (!tokenRow) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "invalid_token" },
              { status: 400 },
            );
          }
          if (tokenRow.used || tokenRow.status === "completed" || tokenRow.status === "bot_update_pending") {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "used" },
              { status: 400 },
            );
          }
          if (tokenRow.expiresAt.getTime() <= now.getTime()) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "expired" },
              { status: 400 },
            );
          }
          if (tokenRow.status === "locked") {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "verification_locked" },
              { status: 429 },
            );
          }
          if (!tokenRow.discordId) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "identity_required" },
              { status: 403 },
            );
          }
          if (tokenRow.discordId !== tokenRow.userId) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "identity_mismatch" },
              { status: 403 },
            );
          }
          const ip = clientIp(request) || "unknown";
          const ipLimit = await consumeConfiguredRateLimit(db, `check-ip:ip:${ip}`, 12, 60_000);
          if (!ipLimit.allowed) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
            );
          }
          const tokenHash = createHash("sha256").update(token).digest("hex");
          const tokenLimit = await consumeConfiguredRateLimit(
            db,
            `check-ip:token:${tokenHash}`,
            12,
            60_000,
          );
          if (!tokenLimit.allowed) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null },
              { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
            );
          }
          const result = await checkIpCached(db, ip === "unknown" ? "" : ip);
          return Response.json(
            {
              status: result.status,
              isVPN: result.isVPN,
              type: result.type,
              ...(result.status === "unavailable" ? { error: "network_check_unavailable" } : {}),
            },
            {
              status: result.status === "unavailable" ? 503 : 200,
              headers: { "cache-control": "no-store" },
            },
          );
        } catch (error) {
          console.error("[check-ip] Failed:", error instanceof Error ? error.name : "unknown");
          return Response.json(
            { status: "unavailable", isVPN: false, type: null, error: "network_check_unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
