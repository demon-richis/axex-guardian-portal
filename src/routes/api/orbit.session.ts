import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({ token: z.string().min(1).max(200) }).strict();

export const Route = createFileRoute("/api/orbit/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isSameOrigin, consumeConfiguredRateLimit } =
          await import("@/lib/rate-limit.server");
        if (!isSameOrigin(request)) {
          return Response.json({ success: false, error: "cross_origin_request" }, { status: 403 });
        }
        const [
          { clientIp, getDb },
          { verifyTokens },
          { verifySession, unauthorizedSessionResponse },
        ] = await Promise.all([
          import("@/lib/db/client.server"),
          import("@/lib/db/schema"),
          import("@/lib/session.server"),
        ]);
        let db;
        try {
          db = getDb();
          const ip = clientIp(request) || "unknown";
          const limit = await consumeConfiguredRateLimit(db, `orbit-session:ip:${ip}`, 10, 60_000);
          if (!limit.allowed) {
            return Response.json(
              { success: false, error: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
            );
          }
        } catch (error) {
          console.error(
            "[orbit/session] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "challenge_unavailable" }, { status: 503 });
        }
        const body = Body.safeParse(await request.json().catch(() => null));
        if (!body.success) {
          return Response.json({ success: false, error: "invalid_request" }, { status: 400 });
        }
        const row = (
          await db
            .select()
            .from(verifyTokens)
            .where(eq(verifyTokens.token, body.data.token))
            .limit(1)
        )[0];
        if (
          !row ||
          row.used ||
          row.expiresAt.getTime() <= Date.now() ||
          row.level !== "high" ||
          !row.discordId ||
          row.discordId !== row.userId
        ) {
          return Response.json({ success: false, error: "invalid_token" }, { status: 403 });
        }
        if (!verifySession(request, body.data.token, row.discordId)) {
          return unauthorizedSessionResponse();
        }
        try {
          const orbit = await import("@/lib/orbit.server");
          if (!orbit.orbitEnabled()) {
            return Response.json(
              { success: false, error: "challenge_unavailable" },
              { status: 503 },
            );
          }
          const { createOrbitSession } = orbit;
          const session = await createOrbitSession(row.discordId, row.guildId);
          return Response.json(
            { success: true, session },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error(
            "[orbit/session] Could not create challenge session:",
            error instanceof Error ? error.message : "unknown error",
          );
          return Response.json({ success: false, error: "challenge_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
