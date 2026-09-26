import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";

export const Route = createFileRoute("/api/suspicious/$guildId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { hasBotApiAccess } = await import("@/lib/api-auth.server");
        if (!hasBotApiAccess(request)) return Response.json({ success: false }, { status: 401 });
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
          return Response.json({ success: true, attempts });
        } catch (error) {
          console.error(error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
