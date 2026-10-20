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
        return drain(parsed.data?.maxJobs ?? 5);
      },
      GET: async ({ request }) => {
        const { validateCronSecret } = await import("@/lib/api-auth.server");
        const authError = validateCronSecret(request);
        if (authError) return authError;
        return drain(10, true);
      },
    },
  },
});

async function drain(maxJobs: number, cleanup = false): Promise<Response> {
  try {
    const [{ processBotCallbackOutbox }, { getDb }, { runPortalRetention }] = await Promise.all([
      import("@/lib/bot-callback-outbox.server"),
      import("@/lib/db/client.server"),
      import("@/lib/retention.server"),
    ]);
    const retention = cleanup ? await runPortalRetention(getDb()) : null;
    const result = await processBotCallbackOutbox(maxJobs);
    return Response.json({ success: true, ...result, ...(retention ? { retention } : {}) });
  } catch (error) {
    console.error("[bot/outbox] Worker failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ success: false, error: "outbox_unavailable" }, { status: 503 });
  }
}
