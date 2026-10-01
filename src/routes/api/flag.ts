import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  guildId: z.string().min(1).max(40),
  userId: z.string().min(1).max(40),
  discordTag: z.string().max(100).nullable().optional(),
  ipAddress: z.string().max(100).nullable().optional(),
  reason: z.string().min(1).max(500),
  accountAgeDays: z.number().int().nonnegative().nullable().optional(),
  clickMs: z.number().int().nonnegative().nullable().optional(),
});

export const Route = createFileRoute("/api/flag")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[flag] Request received");
        const { validateApiKey } = await import("@/lib/api-auth.server");
        const authError = validateApiKey(request);
        if (authError) return authError;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          console.error("[flag] Invalid request body");
          return Response.json({ success: false }, { status: 400 });
        }
        console.log("[flag] Recording suspicious attempt for guild:", parsed.data.guildId);
        try {
          const { auditLogs, suspiciousAttempts } = await import("@/lib/db/schema");
          const db = (await import("@/lib/db/client.server")).getDb();
          const value = parsed.data;
          const attempt = (
            await db
              .insert(suspiciousAttempts)
              .values({
                guildId: value.guildId,
                userId: value.userId,
                discordTag: value.discordTag ?? null,
                ipAddress: value.ipAddress ?? null,
                accountAgeDays: value.accountAgeDays ?? null,
                clickMs: value.clickMs ?? null,
                reason: value.reason,
              })
              .onConflictDoUpdate({
                target: [suspiciousAttempts.guildId, suspiciousAttempts.userId],
                set: {
                  attemptCount: sql`${suspiciousAttempts.attemptCount} + 1`,
                  lastAttemptAt: new Date(),
                  reason: value.reason,
                },
              })
              .returning({ attemptCount: suspiciousAttempts.attemptCount })
          )[0];
          const autoBanned = (attempt?.attemptCount ?? 1) >= 3;
          console.log(
            "[flag] Attempt count:",
            attempt?.attemptCount ?? 1,
            "auto-banned:",
            autoBanned,
          );
          await db.insert(auditLogs).values({
            guildId: value.guildId,
            userId: value.userId,
            discordTag: value.discordTag ?? null,
            eventType: autoBanned ? "AUTO_BANNED" : "SUSPICIOUS",
            severity: autoBanned ? "critical" : "warn",
            ipAddress: value.ipAddress ?? null,
            accountAgeDays: value.accountAgeDays ?? null,
            clickMs: value.clickMs ?? null,
            flagged: true,
            flagReason: value.reason,
          });
          return Response.json({
            success: true,
            autoBanned,
            attemptCount: attempt?.attemptCount ?? 1,
          });
        } catch (error) {
          console.error("[flag] Failed:", error);
          return Response.json({ success: false }, { status: 500 });
        }
      },
    },
  },
});
