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
          console.log("[check-ip] Result:", {
            status: result.status,
            isVPN: result.isVPN,
            type: result.type,
          });
          return Response.json(result, {
            status: result.status === "unavailable" ? 503 : 200,
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          console.error("[check-ip] Failed:", error);
          return Response.json(
            { status: "unavailable", isVPN: false, type: null, ip },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
