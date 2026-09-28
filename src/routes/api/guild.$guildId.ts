import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/guild/$guildId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        console.log("[guild/config] Lookup:", params.guildId);
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;
        try {
          const { guildConfigs } = await import("@/lib/db/schema");
          const config = (
            await (
              await import("@/lib/db/client.server")
            )
              .getDb()
              .select({
                guildId: guildConfigs.guildId,
                guildName: guildConfigs.guildName,
                guildIcon: guildConfigs.guildIcon,
                memberCount: guildConfigs.memberCount,
                logChannelId: guildConfigs.logChannelId,
                verifiedRoleId: guildConfigs.verifiedRoleId,
                quarantineRoleId: guildConfigs.quarantineRoleId,
                createdAt: guildConfigs.createdAt,
                updatedAt: guildConfigs.updatedAt,
              })
              .from(guildConfigs)
              .where(eq(guildConfigs.guildId, params.guildId))
              .limit(1)
          )[0];
          if (!config) {
            console.log("[guild/config] Not found:", params.guildId);
            return Response.json({ success: false }, { status: 404 });
          }
          console.log("[guild/config] Found:", params.guildId);
          return Response.json({ success: true, guild: config });
        } catch (error) {
          console.error("[guild/config] Lookup failed:", error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
