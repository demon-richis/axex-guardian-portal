import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";

export const Route = createFileRoute("/api/audit/$guildId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { hasBotApiAccess } = await import("@/lib/api-auth.server");
        if (!hasBotApiAccess(request)) return Response.json({ success: false }, { status: 401 });
        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
        const severity = url.searchParams.get("severity");
        const eventType = url.searchParams.get("event_type");
        try {
          const { auditLogs } = await import("@/lib/db/schema");
          const filters = [eq(auditLogs.guildId, params.guildId)];
          if (severity === "info" || severity === "warn" || severity === "critical")
            filters.push(eq(auditLogs.severity, severity));
          if (eventType) filters.push(eq(auditLogs.eventType, eventType));
          const logs = await (
            await import("@/lib/db/client.server")
          )
            .getDb()
            .select()
            .from(auditLogs)
            .where(and(...filters))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit);
          return Response.json({ success: true, logs });
        } catch (error) {
          console.error(error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
