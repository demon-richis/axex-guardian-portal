import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.log("[auth/callback] OAuth callback received");
        const { getDb, redirectUri } = await import("../../lib/db/client.server.ts");
        const { bindOAuthIdentity } = await import("../../lib/discord-identity.server.ts");
        const { consumeOAuthState, createSessionCookie } =
          await import("../../lib/session.server.ts");
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const stateNonce = url.searchParams.get("state") ?? "";
        const state = stateNonce ? consumeOAuthState(request, stateNonce) : null;
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
        if (!code || !state) {
          console.error("[auth/callback] Missing, mismatched, or expired OAuth state");
          return back("error=auth");
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
          if (!tokenRes.ok) {
            console.error("[auth/callback] Discord token exchange failed", tokenRes.status);
            return back("error=auth");
          }
          const { access_token } = (await tokenRes.json()) as { access_token: string };
          const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          if (!userRes.ok) {
            console.error("[auth/callback] Discord user lookup failed", userRes.status);
            return back("error=auth");
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
            console.error("[auth/callback] OAuth identity binding refused:", binding.reason);
            return back("error=auth");
          }
          console.log("[auth/callback] OAuth identity matched the bot-issued target");
          return back("auth=1", createSessionCookie(state.token, user.id));
        } catch (e) {
          console.error("[auth/callback] Failed:", e instanceof Error ? e.name : "unknown");
          return back("error=auth");
        }
      },
    },
  },
});
