import { createFileRoute } from "@tanstack/react-router";
import { consumeConfiguredRateLimit } from "../../lib/rate-limit.server.ts";
import { mapDiscordProviderError } from "../../lib/public-errors.ts";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[auth/callback] OAuth callback received");
        const url = new URL(request.url);
        const redirectWithoutState = (errorCode: string) => {
          const destination = new URL("/verify", url.origin);
          destination.searchParams.set("error", errorCode);
          return Response.redirect(destination, 302);
        };

        const { getDb, redirectUri } = await import("../../lib/db/client.server.ts");
        const { clientIp } = await import("../../lib/client-ip.server.ts");
        const { bindOAuthIdentity } = await import("../../lib/discord-identity.server.ts");
        const { consumeOAuthState, createSessionCookie } =
          await import("../../lib/session.server.ts");

        try {
          const ip = clientIp(request) || "unknown";
          const db = process.env["RATE_LIMIT_BACKEND"] === "memory" ? null : getDb();
          const limit = await consumeConfiguredRateLimit(db, `auth-callback:ip:${ip}`, 20, 60_000);
          if (!limit.allowed) return redirectWithoutState("oauth_rate_limited");
        } catch (error) {
          console.error(
            "[auth/callback] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return redirectWithoutState("oauth_service_unavailable");
        }

        const code = url.searchParams.get("code");
        const providerError = url.searchParams.get("error");
        const stateNonce = url.searchParams.get("state") ?? "";
        let state: { token: string; clearCookie: string } | null = null;
        try {
          state = stateNonce ? consumeOAuthState(request, stateNonce) : null;
        } catch (error) {
          console.error(
            "[auth/callback] OAuth state validation unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return redirectWithoutState("oauth_configuration_error");
        }

        const back = (query: string, sessionCookie?: string) => {
          const destination = new URL("/verify", url.origin);
          if (state?.token) destination.searchParams.set("token", state.token);
          for (const [key, value] of new URLSearchParams(query)) {
            destination.searchParams.set(key, value);
          }
          const headers = new Headers({ Location: destination.toString() });
          if (state) headers.append("Set-Cookie", state.clearCookie);
          if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
          return new Response(null, { status: 302, headers });
        };

        if (!state) {
          console.error("[auth/callback] OAuth state missing, mismatched, or expired");
          return back("error=oauth_state_invalid");
        }

        const providerFailure = mapDiscordProviderError(providerError);
        if (providerFailure) {
          console.info("[auth/callback] Discord authorization was not granted", {
            reason: providerFailure,
          });
          return back(`error=${providerFailure}`);
        }
        if (!code) {
          console.error("[auth/callback] Discord callback did not include an authorization code");
          return back("error=oauth_code_missing");
        }

        try {
          const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env["DISCORD_CLIENT_ID"] ?? "",
              client_secret: process.env["DISCORD_CLIENT_SECRET"] ?? "",
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri(request),
            }),
          });
          const tokenBody = (await tokenRes.json().catch(() => null)) as
            | { access_token?: string; error?: string }
            | null;
          if (!tokenRes.ok || !tokenBody?.access_token) {
            const providerCode =
              typeof tokenBody?.error === "string" && /^[a-z_]{1,40}$/.test(tokenBody.error)
                ? tokenBody.error
                : "unknown";
            const configurationFailure = [
              "invalid_client",
              "unauthorized_client",
              "redirect_uri_mismatch",
            ].includes(providerCode);
            console.error("[auth/callback] Discord token exchange failed", {
              status: tokenRes.status,
              providerCode,
            });
            return back(
              `error=${configurationFailure ? "oauth_configuration_error" : "oauth_token_exchange_failed"}`,
            );
          }

          const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${tokenBody.access_token}` },
          });
          if (!userRes.ok) {
            console.error("[auth/callback] Discord user lookup failed", userRes.status);
            return back("error=oauth_profile_lookup_failed");
          }

          const user = (await userRes.json()) as {
            id: string;
            username: string;
            global_name?: string | null;
            avatar: string | null;
          };
          const binding = await bindOAuthIdentity(getDb(), state.token, {
            id: user.id,
            username: user.username,
            globalName: user.global_name,
            avatar: user.avatar,
          });
          if (!binding.success) {
            const bindingErrors: Record<string, string> = {
              invalid_token: "oauth_token_invalid",
              expired_token: "oauth_token_expired",
              already_used: "oauth_token_used",
              identity_mismatch: "oauth_identity_mismatch",
              verification_locked: "oauth_verification_locked",
              verification_inactive: "oauth_token_invalid",
            };
            const publicReason = bindingErrors[binding.reason] ?? "oauth_unknown";
            console.error("[auth/callback] OAuth identity binding refused:", binding.reason);
            return back(`error=${publicReason}`);
          }

          console.log("[auth/callback] OAuth identity matched the bot-issued target");
          return back("auth=1", createSessionCookie(state.token, user.id));
        } catch (error) {
          console.error(
            "[auth/callback] OAuth processing failed:",
            error instanceof Error ? error.name : "unknown",
          );
          return back("error=oauth_service_unavailable");
        }
      },
    },
  },
});
