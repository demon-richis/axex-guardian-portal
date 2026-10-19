import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gt } from "drizzle-orm";
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
              { status: "unavailable", isVPN: false, type: null },
              { status: 400 },
            );
          }
          const db = getDb();
          const now = new Date();
          const tokenRow = (
            await db
              .select({ userId: verifyTokens.userId, discordId: verifyTokens.discordId })
              .from(verifyTokens)
              .where(
                and(
                  eq(verifyTokens.token, token),
                  eq(verifyTokens.used, false),
                  gt(verifyTokens.expiresAt, now),
                ),
              )
              .limit(1)
          )[0];
          if (!tokenRow || !tokenRow.discordId || tokenRow.discordId !== tokenRow.userId) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null },
              { status: 403 },
            );
          }
          const ip = clientIp(request) || "unknown";
          const ipLimit = await consumeConfiguredRateLimit(db, `check-ip:ip:${ip}`, 12, 60_000);
          if (!ipLimit.allowed) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null },
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
            { status: result.status, isVPN: result.isVPN, type: result.type },
            {
              status: result.status === "unavailable" ? 503 : 200,
              headers: { "cache-control": "no-store" },
            },
          );
        } catch (error) {
          console.error("[check-ip] Failed:", error instanceof Error ? error.name : "unknown");
          return Response.json(
            { status: "unavailable", isVPN: false, type: null },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
