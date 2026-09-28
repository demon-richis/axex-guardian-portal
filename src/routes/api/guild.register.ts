import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  guildId: z.string().min(1).max(40),
  guildName: z.string().min(1).max(200),
  guildIcon: z.string().max(300).nullable().optional(),
  memberCount: z.number().int().nonnegative().optional(),
  webhookUrl: z.string().url(),
  logChannelId: z.string().max(40).nullable().optional(),
  verifiedRoleId: z.string().max(40).nullable().optional(),
  quarantineRoleId: z.string().max(40).nullable().optional(),
});

export const Route = createFileRoute("/api/guild/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[guild/register] Request received");
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          console.error("[guild/register] Invalid request body");
          return Response.json({ success: false }, { status: 400 });
        }
        console.log("[guild/register] Upserting guild:", parsed.data.guildId);
        try {
          const { guildConfigs } = await import("@/lib/db/schema");
          const config = await (
            await import("@/lib/db/client.server")
          )
            .getDb()
            .insert(guildConfigs)
            .values({
              guildId: parsed.data.guildId,
              guildName: parsed.data.guildName,
              guildIcon: parsed.data.guildIcon ?? null,
              memberCount: parsed.data.memberCount ?? 0,
              webhookUrl: parsed.data.webhookUrl,
              logChannelId: parsed.data.logChannelId ?? null,
              verifiedRoleId: parsed.data.verifiedRoleId ?? null,
              quarantineRoleId: parsed.data.quarantineRoleId ?? null,
            })
            .onConflictDoUpdate({
              target: guildConfigs.guildId,
              set: {
                guildName: parsed.data.guildName,
                guildIcon: parsed.data.guildIcon ?? null,
                memberCount: parsed.data.memberCount ?? 0,
                webhookUrl: parsed.data.webhookUrl,
                logChannelId: parsed.data.logChannelId ?? null,
                verifiedRoleId: parsed.data.verifiedRoleId ?? null,
                quarantineRoleId: parsed.data.quarantineRoleId ?? null,
                updatedAt: new Date(),
              },
            })
            .returning();
          console.log("[guild/register] Saved successfully:", parsed.data.guildId);
          return Response.json({ success: true, guild: config[0] });
        } catch (error) {
          console.error("[guild/register] Failed:", error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
