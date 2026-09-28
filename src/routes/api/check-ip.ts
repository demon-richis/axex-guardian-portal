import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/check-ip")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkIp, clientIp } = await import("@/lib/db/client.server");
        const ip = clientIp(request);
        console.log("[check-ip] Checking request IP:", ip ? "present" : "unavailable");
        try {
          const result = await checkIp(ip);
          console.log("[check-ip] Result:", { isVPN: result.isVPN, type: result.type });
          return Response.json(result, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("[check-ip] Failed:", error);
          return Response.json(
            { isVPN: false, type: null, ip },
            { headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
