import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ maxJobs: z.number().int().min(1).max(10).optional() }).optional();

export const Route = createFileRoute("/api/bot/outbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return Response.json({ success: false, error: "invalid_request" }, { status: 400 });
        }
        try {
          const { processBotCallbackOutbox } = await import("@/lib/bot-callback-outbox.server");
          const result = await processBotCallbackOutbox(parsed.data?.maxJobs ?? 5);
          return Response.json({ success: true, ...result });
        } catch (error) {
          console.error(
            "[bot/outbox] Worker failed:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json({ success: false, error: "outbox_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
