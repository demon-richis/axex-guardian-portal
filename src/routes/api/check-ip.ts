import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/check-ip")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [
            { clientIp, getDb, checkIp, snowflakeToDate },
            { verifyTokens },
            { checkIpCached },
            { consumeConfiguredRateLimit },
            { unauthorizedSessionResponse, verifySession },
            { policyForToken },
            { RiskSignalsSchema, classifyVerificationLevel, maxVerificationLevel },
            { analyzePortalUser },
            { riskSignalsFromIntelligence },
          ] = await Promise.all([
            import("@/lib/db/client.server"),
            import("@/lib/db/schema"),
            import("@/lib/ip-check-cache.server"),
            import("@/lib/rate-limit.server"),
            import("@/lib/session.server"),
            import("@/lib/verification-policy.server"),
            import("@/lib/verification-level.server"),
            import("@/lib/intelligence.server"),
            import("@/lib/intelligence-signals.server"),
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
            await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
          )[0];
          if (!tokenRow) {
            return Response.json(
              { status: "unavailable", isVPN: false, type: null, error: "invalid_token" },
              { status: 400 },
            );
          }
          if (
            tokenRow.used ||
            tokenRow.status === "completed" ||
            tokenRow.status === "bot_update_pending"
          ) {
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
          if (!verifySession(request, token, tokenRow.discordId)) {
            return unauthorizedSessionResponse();
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
          const policy = policyForToken(tokenRow.policy);
          const result = await checkIpCached(db, ip === "unknown" ? "" : ip, (address) =>
            checkIp(address, policy.networkFailMode),
          );
          let level = tokenRow.level;
          if (result.status !== "unavailable") {
            const parsedRiskSignals = RiskSignalsSchema.safeParse(tokenRow.riskSignals ?? {});
            const intelligence = await analyzePortalUser(tokenRow.discordId, tokenRow.guildId, {
              username: tokenRow.discordUsername,
              avatar: tokenRow.discordAvatar,
              createdTimestamp: snowflakeToDate(tokenRow.discordId).getTime(),
              ip,
            });
            const riskSignals = {
              ...(parsedRiskSignals.success ? parsedRiskSignals.data : {}),
              ...riskSignalsFromIntelligence(intelligence),
              ...(result.flagged === true ? { knownBadIp: true, blocklistHit: true } : {}),
            };
            const accountAgeDays = Math.max(
              0,
              Math.floor((Date.now() - snowflakeToDate(tokenRow.discordId).getTime()) / 86_400_000),
            );
            const calculatedLevel = classifyVerificationLevel({
              initialLevel: tokenRow.initialLevel,
              accountAgeDays,
              newAccountDays: policy.newAccountDays,
              riskSignals: {
                ...riskSignals,
                defaultAvatar: riskSignals.defaultAvatar || !tokenRow.discordAvatar,
              },
              vpnDetected: result.isVPN,
              ...(intelligence?.recommendation !== undefined
                ? { intelligenceRecommendation: intelligence.recommendation }
                : {}),
            });
            level = maxVerificationLevel(tokenRow.level, calculatedLevel);
            await db
              .update(verifyTokens)
              .set({ level, riskSignals })
              .where(
                and(
                  eq(verifyTokens.token, token),
                  eq(verifyTokens.used, false),
                  inArray(verifyTokens.status, ["pending", "failed"]),
                ),
              );
            if (level === "critical") {
              const { queueCriticalVerification } =
                await import("@/lib/verification-critical.server");
              const queued = await queueCriticalVerification(
                db,
                token,
                riskSignals.confirmedAltOfBanned
                  ? "Confirmed banned-user alt"
                  : riskSignals.knownBadIp
                    ? "Known-bad IP"
                    : riskSignals.blocklistHit
                      ? "Blocklist hit"
                      : "Critical risk signal",
              );
              if (queued) {
                const { processBotCallbackOutbox } =
                  await import("@/lib/bot-callback-outbox.server");
                const delivery = processBotCallbackOutbox(1, tokenRow.referenceId ?? undefined);
                if (process.env["VERCEL"] === "1") {
                  const { waitUntil } = await import("@vercel/functions");
                  waitUntil(delivery);
                } else {
                  await delivery;
                }
              }
              return Response.json(
                { status: "quarantined", isVPN: result.isVPN, type: result.type, level },
                { headers: { "cache-control": "no-store" } },
              );
            }
          }
          return Response.json(
            {
              status: result.status,
              isVPN: result.isVPN,
              type: result.type,
              level,
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
