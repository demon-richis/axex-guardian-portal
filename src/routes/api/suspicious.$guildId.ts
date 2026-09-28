import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";

export const Route = createFileRoute("/api/suspicious/$guildId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        console.log("[suspicious] Request received for guild:", params.guildId);
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;
        try {
          const { suspiciousAttempts } = await import("@/lib/db/schema");
          const attempts = await (
            await import("@/lib/db/client.server")
          )
            .getDb()
            .select()
            .from(suspiciousAttempts)
            .where(eq(suspiciousAttempts.guildId, params.guildId))
            .orderBy(desc(suspiciousAttempts.lastAttemptAt));
          console.log("[suspicious] Returned entries:", attempts.length);
          return Response.json({ success: true, attempts });
        } catch (error) {
          console.error("[suspicious] Query failed:", error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
