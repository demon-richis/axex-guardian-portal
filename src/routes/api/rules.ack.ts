import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ token: z.string().min(1).max(200) }).strict();

export const Route = createFileRoute("/api/rules/ack")({
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
        try {
          db = getDb();
          const ip = clientIp(request) || "unknown";
          const limit = await consumeConfiguredRateLimit(db, `rules-ack:ip:${ip}`, 12, 60_000);
          if (!limit.allowed) {
            return Response.json(
              { success: false, error: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
            );
          }
        } catch (error) {
          console.error(
            "[rules/ack] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "service_unavailable" }, { status: 503 });
        }

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ success: false, error: "invalid_request" }, { status: 400 });
        }
        const { verifyTokens } = await import("@/lib/db/schema");
        const { eq } = await import("drizzle-orm");
        const row = (
          await db
            .select({ discordId: verifyTokens.discordId })
            .from(verifyTokens)
            .where(eq(verifyTokens.token, parsed.data.token))
            .limit(1)
        )[0];
        if (!row?.discordId) {
          return Response.json({ success: false, error: "invalid_token" }, { status: 400 });
        }
        if (!verifySession(request, parsed.data.token, row.discordId)) {
          return unauthorizedSessionResponse();
        }

        try {
          const { acknowledgeVerificationRules } = await import("@/lib/verification-rules.server");
          const result = await acknowledgeVerificationRules(db, parsed.data.token, row.discordId);
          if (!result.success) {
            return Response.json(result, {
              status: result.error === "identity_mismatch" ? 403 : 409,
            });
          }
          return Response.json({
            success: true,
            acknowledgedAt: result.acknowledgedAt.toISOString(),
          });
        } catch (error) {
          console.error(
            "[rules/ack] Could not store acknowledgement:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "service_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
