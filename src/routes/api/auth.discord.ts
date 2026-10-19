import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/auth/discord")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[auth/discord] OAuth start requested");
        const { clientIp, getDb, redirectUri } = await import("../../lib/db/client.server.ts");
        const { consumeConfiguredRateLimit } = await import("../../lib/rate-limit.server.ts");
        const token = new URL(request.url).searchParams.get("token") ?? "";
        try {
          const db = process.env["RATE_LIMIT_BACKEND"] === "memory" ? null : getDb();
          const ip = clientIp(request) || "unknown";
          const ipLimit = await consumeConfiguredRateLimit(db, `auth-discord:ip:${ip}`, 20, 60_000);
          if (!ipLimit.allowed) {
            return Response.json(
              { error: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
            );
          }
          if (token) {
            const tokenHash = createHash("sha256").update(token).digest("hex");
            const tokenLimit = await consumeConfiguredRateLimit(
              db,
              `auth-discord:token:${tokenHash}`,
              10,
              60 * 60_000,
            );
            if (!tokenLimit.allowed) {
              return Response.json(
                { error: "rate_limited" },
                { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
              );
            }
          }
        } catch (error) {
          console.error(
            "[auth/discord] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
        }
        const { createOAuthState } = await import("../../lib/session.server.ts");
        const clientId = process.env["DISCORD_CLIENT_ID"];
        if (!clientId || !token) {
          console.error(
            "[auth/discord] Missing Discord client configuration or verification token",
          );
          return Response.redirect(
            `${new URL(request.url).origin}/verify?token=${encodeURIComponent(token)}&error=config`,
            302,
          );
        }
        const url = new URL("https://discord.com/oauth2/authorize");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri(request));
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "identify");
        const state = createOAuthState(token);
        url.searchParams.set("state", state.nonce);
        url.searchParams.set("prompt", "none");
        console.log("[auth/discord] Redirecting to Discord OAuth");
        const headers = new Headers({ Location: url.toString() });
        headers.append("Set-Cookie", state.cookie);
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
