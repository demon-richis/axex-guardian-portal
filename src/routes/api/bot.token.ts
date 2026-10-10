import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  token: z.string().min(1).max(200),
  userId: z.string().min(1).max(40),
  guildId: z.string().min(1).max(40),
  guildName: z.string().max(200).optional(),
  guildMemberCount: z.number().int().nonnegative().optional(),
  expiresAt: z.string().datetime({ offset: true }),
});

export const Route = createFileRoute("/api/bot/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[bot/token] Request received");
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          console.error("[bot/token] Invalid request body");
          return Response.json({ error: "Missing or invalid required fields" }, { status: 400 });
        }

        try {
          const crypto = await import("node:crypto");
          const { verifyTokens } = await import("@/lib/db/schema");
          const { auditLogs } = await import("@/lib/db/schema");
          const { getDb } = await import("@/lib/db/client.server");
          const { token, userId, guildId, guildName, guildMemberCount, expiresAt } = parsed.data;
          const db = getDb();
          const now = new Date();
          const retentionDays = Math.min(
            365,
            Math.max(7, Number(process.env.AXEX_RETENTION_DAYS || 90)),
          );
          const retentionCutoff = new Date(now.getTime() - retentionDays * 86_400_000);

          await db.delete(verifyTokens).where(lt(verifyTokens.createdAt, retentionCutoff));
          await db.delete(auditLogs).where(lt(auditLogs.createdAt, retentionCutoff));

          const active = await db
            .select({ token: verifyTokens.token, referenceId: verifyTokens.referenceId })
            .from(verifyTokens)
            .where(
              and(
                eq(verifyTokens.userId, userId),
                eq(verifyTokens.guildId, guildId),
                gt(verifyTokens.expiresAt, now),
                inArray(verifyTokens.status, ["pending", "bot_update_pending"]),
              ),
            )
            .limit(1);
          if (active[0]) {
            return Response.json({
              success: true,
              reused: true,
              token: active[0].token,
              referenceId: active[0].referenceId,
            });
          }
          const referenceId = `AX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
          console.log("[bot/token] Received token:", `${token.slice(0, 8)}…`);

          await db
            .insert(verifyTokens)
            .values({
              token,
              userId,
              guildId,
              guildName: guildName || "Unknown",
              guildMemberCount: guildMemberCount || 0,
              expiresAt: new Date(expiresAt),
              used: false,
              status: "pending",
              referenceId,
            })
            .onConflictDoNothing();

          console.log("[bot/token] Saved successfully");
          return Response.json({ success: true, token, referenceId });
        } catch (error) {
          console.error("[bot/token] Error:", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
