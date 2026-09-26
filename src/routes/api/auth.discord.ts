import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/discord")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { redirectUri } = await import("@/lib/db/client.server");
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const clientId = process.env["DISCORD_CLIENT_ID"];
        if (!clientId || !token) {
          return Response.redirect(`${new URL(request.url).origin}/verify?token=${encodeURIComponent(token)}&error=config`, 302);
        }
        const url = new URL("https://discord.com/oauth2/authorize");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri(request));
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "identify");
        url.searchParams.set("state", token);
        url.searchParams.set("prompt", "none");
        return Response.redirect(url.toString(), 302);
      },
    },
  },
});
