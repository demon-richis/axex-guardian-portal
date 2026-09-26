import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/check-ip")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkIp, clientIp } = await import("@/lib/db/client.server");
        return Response.json(await checkIp(clientIp(request)), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
