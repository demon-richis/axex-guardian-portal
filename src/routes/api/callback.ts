import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  token: z.string().min(1).max(200),
  discordId: z.string().max(40).optional(),
  discordTag: z.string().max(100).optional(),
  discordAvatar: z.string().max(200).nullable().optional(),
  passed: z.boolean(),
  vpnDetected: z.boolean().optional(),
  accountAge: z.number().optional(),
});

export const Route = createFileRoute("/api/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getDb, snowflakeToDate, checkIp, clientIp } = await import("@/lib/db/client.server");
        const { verifyTokens } = await import("@/lib/db/schema");
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ success: false }, { status: 400 });
        const { token, passed } = parsed.data;
        try {
          const db = getDb();
          const row = (await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1))[0];
          if (!row || row.used || row.expiresAt.getTime() < Date.now() || !row.discordId) {
            return Response.json({ success: false }, { status: 400 });
          }
          // Re-check network server-side; never trust the browser's values
          const ip = await checkIp(clientIp(request));
          const accountAge = Math.floor((Date.now() - snowflakeToDate(row.discordId).getTime()) / 86400000);
          const updated = await db
            .update(verifyTokens)
            .set({ used: true })
            .where(and(eq(verifyTokens.token, token), eq(verifyTokens.used, false)))
            .returning({ token: verifyTokens.token });
          if (updated.length === 0) return Response.json({ success: false }, { status: 409 });

          const result = {
            token,
            userId: row.userId,
            guildId: row.guildId,
            guildName: row.guildName,
            discordId: row.discordId,
            discordTag: row.discordUsername,
            discordAvatar: row.discordAvatar,
            passed: passed && !ip.isVPN,
            vpnDetected: ip.isVPN,
            accountAge,
            verifiedAt: new Date().toISOString(),
          };
          const webhook = process.env["DISCORD_BOT_WEBHOOK"];
          if (webhook) {
            const res = await fetch(webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(result),
            });
            if (!res.ok) console.error("Bot webhook failed", res.status, await res.text());
          }
          return Response.json({ success: true });
        } catch (e) {
          console.error(e);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
