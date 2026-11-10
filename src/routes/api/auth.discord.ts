import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/auth/discord")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[auth/discord] OAuth start requested");
        const requestUrl = new URL(request.url);
        const token = requestUrl.searchParams.get("token") ?? "";
        const redirectWithError = (errorCode: string) => {
          const destination = new URL("/verify", requestUrl.origin);
          if (token) destination.searchParams.set("token", token);
          destination.searchParams.set("error", errorCode);
          return Response.redirect(destination, 302);
        };

        const { clientIp, getDb, redirectUri } = await import("../../lib/db/client.server.ts");
        const { consumeConfiguredRateLimit } = await import("../../lib/rate-limit.server.ts");

        if (!token) return redirectWithError("oauth_token_invalid");

        try {
          const db = process.env["RATE_LIMIT_BACKEND"] === "memory" ? null : getDb();
          const ip = clientIp(request) || "unknown";
          const ipLimit = await consumeConfiguredRateLimit(db, `auth-discord:ip:${ip}`, 20, 60_000);
          if (!ipLimit.allowed) return redirectWithError("oauth_rate_limited");

          const tokenHash = createHash("sha256").update(token).digest("hex");
          const tokenLimit = await consumeConfiguredRateLimit(
            db,
            `auth-discord:token:${tokenHash}`,
            10,
            60 * 60_000,
          );
          if (!tokenLimit.allowed) return redirectWithError("oauth_rate_limited");
        } catch (error) {
          console.error(
            "[auth/discord] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return redirectWithError("oauth_service_unavailable");
        }

        const clientId = process.env["DISCORD_CLIENT_ID"];
        if (!clientId || !process.env["DISCORD_CLIENT_SECRET"]) {
          console.error("[auth/discord] Discord OAuth client configuration is incomplete");
          return redirectWithError("oauth_configuration_error");
        }

        try {
          const { createOAuthState } = await import("../../lib/session.server.ts");
          const oauthUrl = new URL("https://discord.com/oauth2/authorize");
          oauthUrl.searchParams.set("client_id", clientId);
          oauthUrl.searchParams.set("redirect_uri", redirectUri(request));
          oauthUrl.searchParams.set("response_type", "code");
          oauthUrl.searchParams.set("scope", "identify");
          const state = createOAuthState(token);
          oauthUrl.searchParams.set("state", state.nonce);
          oauthUrl.searchParams.set("prompt", "none");
          console.log("[auth/discord] Redirecting to Discord OAuth");
          const headers = new Headers({ Location: oauthUrl.toString() });
          headers.append("Set-Cookie", state.cookie);
          return new Response(null, { status: 302, headers });
        } catch (error) {
          console.error(
            "[auth/discord] Could not create OAuth state:",
            error instanceof Error ? error.name : "unknown",
          );
          return redirectWithError("oauth_configuration_error");
        }
      },
    },
  },
});
