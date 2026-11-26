import { eq, sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { verifyTokens } from "./db/schema.ts";
import { ensureVerificationState } from "./verification-state.server.ts";

type PortalDb = ReturnType<typeof getDb>;

export async function queueCriticalVerification(
  db: PortalDb,
  token: string,
  reason: string,
  now = new Date(),
): Promise<boolean> {
  const row = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  if (!row || row.used || row.expiresAt.getTime() <= now.getTime() || !row.referenceId) {
    return false;
  }
  await ensureVerificationState(db, row.guildId, row.userId, now);
  const payload = {
    guildId: row.guildId,
    referenceId: row.referenceId,
    caseCode: row.caseCode ?? null,
    userId: row.discordId,
    discordId: row.discordId,
    discordTag: row.discordTag ?? row.discordUsername,
    discordAvatar: row.discordAvatar,
    passed: false,
    vpnDetected: row.vpnDetected ?? false,
    vpnType: row.vpnType,
    botDetected: false,
    honeypotTriggered: false,
    honeypotAction: "quarantine",
    flagged: true,
    flagReason: reason.slice(0, 300),
    failureReason: reason.slice(0, 300),
    attempts: row.attempts,
    cooldownUntil: null,
    locked: true,
    level: "critical",
  };
  const result = await db.execute(sql`
    WITH claimed AS (
      UPDATE verify_tokens
      SET used = TRUE,
          status = 'bot_update_pending',
          level = 'critical',
          flagged = TRUE,
          flag_reason = ${reason.slice(0, 300)},
          failure_reason = ${reason.slice(0, 300)},
          completed_at = NULL
      WHERE token = ${token}
        AND used = FALSE
        AND expires_at > ${now}
      RETURNING token
    ),
    locked AS (
      UPDATE verification_state
      SET locked_at = COALESCE(locked_at, ${now}),
          updated_at = ${now}
      WHERE guild_id = ${row.guildId}
        AND user_id = ${row.userId}
        AND EXISTS (SELECT 1 FROM claimed)
      RETURNING user_id
    ),
    queued AS (
      INSERT INTO bot_callback_outbox (reference_id, token, payload)
      SELECT ${row.referenceId}, ${token}, ${JSON.stringify(payload)}::jsonb
      FROM claimed
      ON CONFLICT (reference_id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM claimed)::int AS claimed
  `);
  return Number((result.rows[0] as { claimed?: number } | undefined)?.claimed ?? 0) > 0;
}
