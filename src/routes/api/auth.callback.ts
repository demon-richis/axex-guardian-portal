import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getDb, redirectUri } = await import("@/lib/db/client.server");
        const { verifyTokens } = await import("@/lib/db/schema");
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const token = url.searchParams.get("state") ?? "";
        const back = (q: string) =>
          Response.redirect(`${url.origin}/verify?token=${encodeURIComponent(token)}&${q}`, 302);
        if (!code || !token) return back("error=auth");
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
            console.error("Discord token exchange failed", tokenRes.status, await tokenRes.text());
            return back("error=auth");
          }
          const { access_token } = (await tokenRes.json()) as { access_token: string };
          const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          if (!userRes.ok) return back("error=auth");
          const user = (await userRes.json()) as {
            id: string;
            username: string;
            global_name?: string | null;
            avatar: string | null;
          };
          await getDb()
            .update(verifyTokens)
            .set({
              discordId: user.id,
              discordUsername: user.username,
              discordTag: user.global_name ?? user.username,
              discordAvatar: user.avatar,
            })
            .where(and(eq(verifyTokens.token, token), eq(verifyTokens.used, false)));
          return back("auth=1");
        } catch (e) {
          console.error(e);
          return back("error=auth");
        }
      },
    },
  },
});
