import { and, eq, lt, sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { auditLogs, botCallbackOutbox, ipCheckCache, rateLimitBuckets } from "./db/schema.ts";

type PortalDb = ReturnType<typeof getDb>;

function retentionDays(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key];
  if (value === undefined || value === "") return fallback;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error(`${key} must be an integer between 1 and 3650`);
  }
  return days;
}

export async function runPortalRetention(
  db: PortalDb,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<{ tokensDeleted: number; auditLogsDeleted: number; outboxDeleted: number; transientRowsDeleted: number }> {
  const tokenDays = retentionDays(env, "TOKEN_RETENTION_DAYS", 30);
  const auditDays = retentionDays(env, "AUDIT_LOG_RETENTION_DAYS", 365);
  const outboxDays = retentionDays(env, "OUTBOX_RETENTION_DAYS", 30);
  const tokenCutoff = new Date(now.getTime() - tokenDays * 86_400_000);
  const auditCutoff = new Date(now.getTime() - auditDays * 86_400_000);
  const outboxCutoff = new Date(now.getTime() - outboxDays * 86_400_000);

  const expiredTokens = await db.execute(sql`
    DELETE FROM verify_tokens AS token
    WHERE token.created_at < ${tokenCutoff}
      AND NOT EXISTS (
        SELECT 1
        FROM bot_callback_outbox AS queued
        WHERE queued.token = token.token
          AND queued.status IN ('pending', 'processing')
      )
    RETURNING token.token
  `);
  const expiredOutbox = await db
    .delete(botCallbackOutbox)
    .where(and(eq(botCallbackOutbox.status, "delivered"), lt(botCallbackOutbox.deliveredAt, outboxCutoff)))
    .returning({ id: botCallbackOutbox.id });
  const expiredAuditLogs = await db
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, auditCutoff))
    .returning({ id: auditLogs.id });
  const expiredBuckets = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.expiresAt, now))
    .returning({ bucketHash: rateLimitBuckets.bucketHash });
  const expiredIpChecks = await db
    .delete(ipCheckCache)
    .where(lt(ipCheckCache.expiresAt, now))
    .returning({ ipHash: ipCheckCache.ipHash });

  return {
    tokensDeleted: expiredTokens.rows.length,
    auditLogsDeleted: expiredAuditLogs.length,
    outboxDeleted: expiredOutbox.length,
    transientRowsDeleted: expiredBuckets.length + expiredIpChecks.length,
  };
}
