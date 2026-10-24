import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { z } from "zod";

const Body = z.object({ token: z.string().min(1).max(200) });

export const Route = createFileRoute("/api/challenge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isSameOrigin, consumeConfiguredRateLimit } =
          await import("@/lib/rate-limit.server");
        if (!isSameOrigin(request)) {
          return Response.json({ success: false, error: "cross_origin_request" }, { status: 403 });
        }
        const [{ clientIp, getDb }, { unauthorizedSessionResponse, verifySession }] =
          await Promise.all([import("@/lib/db/client.server"), import("@/lib/session.server")]);
        let db;
        let limit;
        try {
          db = getDb();
          const ip = clientIp(request) || "unknown";
          limit = await consumeConfiguredRateLimit(db, `challenge:ip:${ip}`, 12, 60_000);
        } catch (error) {
          console.error(
            "[challenge] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "challenge_unavailable" }, { status: 503 });
        }
        if (!limit.allowed) {
          return Response.json(
            { success: false, error: "rate_limited" },
            {
              status: 429,
              headers: { "Retry-After": String(limit.retryAfterSeconds) },
            },
          );
        }
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ success: false, error: "invalid_request" }, { status: 400 });
        }
        if (!verifySession(request, parsed.data.token)) return unauthorizedSessionResponse();
        const tokenFingerprint = createHash("sha256").update(parsed.data.token).digest("hex");
        let tokenLimit;
        try {
          tokenLimit = await consumeConfiguredRateLimit(
            db,
            `challenge:token:${tokenFingerprint}`,
            12,
            60_000,
          );
        } catch (error) {
          console.error(
            "[challenge] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "challenge_unavailable" }, { status: 503 });
        }
        if (!tokenLimit.allowed) {
          return Response.json(
            { success: false, error: "rate_limited" },
            { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
          );
        }
        try {
          const { issueVerificationChallenge } =
            await import("@/lib/verification-challenge.server");
          const result = await issueVerificationChallenge(db, parsed.data.token);
          if (result.success) {
            return Response.json({
              ...result,
              siteKey: process.env["TURNSTILE_SITE_KEY"] ?? "",
            });
          }
          const status =
            result.error === "invalid_token" ||
            result.error === "expired" ||
            result.error === "used"
              ? 400
              : result.error === "locked" || result.error === "cooldown"
                ? 429
                : 403;
          return Response.json(result, { status });
        } catch (error) {
          console.error(
            "[challenge] Could not issue challenge:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "challenge_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
