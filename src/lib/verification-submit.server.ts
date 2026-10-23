import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { auditLogs, suspiciousAttempts, verifyTokens } from "./db/schema.ts";
import { ensureVerificationState } from "./verification-state.server.ts";
import { verifyTurnstile } from "./turnstile.server.ts";

type PortalDb = ReturnType<typeof getDb>;

export type ChallengeSubmission = {
  token: string;
  challengeId: string;
  answer?: string | undefined;
  turnstileToken?: string | undefined;
  discordId?: string | undefined;
  discordTag?: string | undefined;
  discordAvatar?: string | null | undefined;
  clickMs?: number | undefined;
  timeout?: boolean | undefined;
  failureReason?: "WRONG_ANSWER" | "TIMEOUT" | "BOT_DETECTED" | "VPN_BLOCKED" | undefined;
  honeypotTriggered?: boolean | undefined;
  honeypot?: string | undefined;
  vpnDetected?: boolean | undefined;
  vpnType?: string | null | undefined;
  observedIp: string;
  requestHostname: string;
  isVpn: boolean;
  vpnTypeDetected: string | null;
  turnstileFetch?: typeof fetch | undefined;
  turnstileEnvironment?: NodeJS.ProcessEnv | undefined;
  now?: Date | undefined;
};

export type SubmissionResult = {
  success: boolean;
  passed?: boolean;
  status?: string;
  referenceId?: string | null;
  attempts?: number;
  cooldownUntil?: string | null;
  failureReason?: string | null;
  locked?: boolean;
  idempotent?: boolean;
  error?: string;
  httpStatus?: number;
};

function ageInDays(discordId: string, now: Date): number {
  const created = new Date(Number(BigInt(discordId) >> 22n) + 1420070400000);
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000));
}

export async function submitVerificationChallenge(
  db: PortalDb,
  input: ChallengeSubmission,
): Promise<SubmissionResult> {
  const now = input.now ?? new Date();
  const row = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, input.token)).limit(1)
  )[0];
  if (!row) return { success: false, error: "invalid_token", httpStatus: 400 };
  const state = await ensureVerificationState(db, row.guildId, row.userId, now);
  if (!state) return { success: false, error: "invalid_token", httpStatus: 400 };

  const submittedDigest = createHash("sha256")
    .update(
      `${input.token}\u0000${row.discordId ?? ""}\u0000${row.guildId}\u0000${input.challengeId}\u0000${input.turnstileToken ?? ""}`,
    )
    .digest("hex");
  if (
    row.challengeId === input.challengeId &&
    row.challengeConsumedAt &&
    row.challengeSubmissionHash === submittedDigest
  ) {
    const terminal = Boolean(row.used);
    return {
      success: true,
      passed: Boolean(row.completedAt),
      status: row.status,
      referenceId: row.referenceId,
      attempts: state.attempts,
      cooldownUntil: state.cooldownUntil?.toISOString() ?? null,
      failureReason: row.failureReason,
      locked: Boolean(state.lockedAt) || state.attempts >= 3,
      idempotent: true,
      ...(terminal && row.status === "bot_update_pending" ? { error: "bot_update_pending" } : {}),
    };
  }

  if (row.used || row.status === "completed") {
    return { success: false, error: "used", httpStatus: 409 };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { success: false, error: "expired", httpStatus: 400 };
  }
  if (
    !row.discordId ||
    row.discordId !== row.userId ||
    (input.discordId && input.discordId !== row.discordId)
  ) {
    return { success: false, error: "identity_mismatch", httpStatus: 403 };
  }
  if (row.challengeId === input.challengeId && row.challengeConsumedAt) {
    return { success: false, error: "challenge_already_consumed", httpStatus: 409 };
  }
  if (row.status === "locked" || state.lockedAt || state.attempts >= 3) {
    return {
      success: false,
      error: "attempts_exhausted",
      attempts: state.attempts,
      httpStatus: 429,
    };
  }
  if (state.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) {
    return {
      success: false,
      error: "cooldown",
      attempts: state.attempts,
      cooldownUntil: state.cooldownUntil.toISOString(),
      httpStatus: 429,
    };
  }
  if (
    !row.challengeId ||
    row.challengeId !== input.challengeId ||
    !row.challengeIssuedAt ||
    !row.challengeExpiresAt ||
    row.challengeExpiresAt.getTime() <= now.getTime() ||
    row.challengeConsumedAt
  ) {
    return { success: false, error: "invalid_or_expired_challenge", httpStatus: 409 };
  }
  if (!row.referenceId) {
    return { success: false, error: "missing_reference", httpStatus: 503 };
  }

  const responseTimeMs = Math.max(0, now.getTime() - row.challengeIssuedAt.getTime());
  const turnstile = await verifyTurnstile(
    input.turnstileToken,
    {
      token: input.token,
      discordId: row.discordId,
      guildId: row.guildId,
      challengeId: input.challengeId,
      requestHostname: input.requestHostname,
      remoteIp: input.observedIp,
    },
    input.turnstileEnvironment ?? process.env,
    input.turnstileFetch,
  );
  if (!turnstile.ok && turnstile.error === "turnstile_unavailable") {
    return {
      success: false,
      error: turnstile.error,
      httpStatus: 503,
    };
  }
  const proofCorrect = turnstile.ok;
  const attempts = state.attempts + 1;
  const accountAgeDays = ageInDays(row.discordId, now);
  const clickMs = input.clickMs ?? null;
  const honeypotTriggered = Boolean(input.honeypotTriggered || input.honeypot?.trim());
  const vpnDetected = input.isVpn || input.vpnDetected === true;
  const vpnType = input.vpnTypeDetected ?? input.vpnType ?? null;
  const botDetected = honeypotTriggered;
  const sameIpUsers = input.observedIp
    ? Number(
        (
          await db.execute(
            sql`select count(distinct ${auditLogs.userId}) as count from ${auditLogs} where ${auditLogs.guildId} = ${row.guildId} and ${auditLogs.ipAddress} = ${input.observedIp}`,
          )
        ).rows[0]?.["count"] ?? 0,
      )
    : 0;
  const automaticReason = honeypotTriggered
    ? "Hidden verification trap activated"
    : vpnDetected
      ? "VPN or proxy detected"
      : accountAgeDays < 7
        ? "New Discord account"
        : attempts >= 2
          ? "Repeated verification attempt"
          : sameIpUsers >= 3
            ? "Shared IP used by multiple users"
            : null;
  const flagged = Boolean(automaticReason);
  const finalPassed = proofCorrect && !vpnDetected && !honeypotTriggered;
  const locked = !finalPassed && (attempts >= 3 || vpnDetected || honeypotTriggered);
  const terminal = finalPassed || locked || vpnDetected;
  const cooldownUntil = terminal
    ? null
    : attempts === 1
      ? new Date(now.getTime() + 3 * 60 * 1000)
      : attempts === 2
        ? new Date(now.getTime() + 3 * 60 * 60 * 1000)
        : null;
  const committedAttempts = finalPassed ? 0 : attempts;
  const committedCooldownUntil = finalPassed ? null : cooldownUntil;
  const committedLocked = finalPassed ? false : locked;
  const event = botDetected
    ? "BOT_DETECTED"
    : vpnDetected
      ? "VPN_BLOCKED"
      : finalPassed
        ? "VERIFIED"
        : "WRONG_ANSWER";
  const reason = automaticReason ?? (finalPassed ? null : (input.failureReason ?? event));
  const callbackStatus = terminal ? "bot_update_pending" : "failed";
  const claimId = randomUUID();
  const safeTag = input.discordTag ?? row.discordTag ?? row.discordUsername;
  const safeAvatar = input.discordAvatar ?? row.discordAvatar;
  const callbackPayload = {
    guildId: row.guildId,
    referenceId: row.referenceId,
    userId: row.discordId,
    discordId: row.discordId,
    discordTag: safeTag,
    discordAvatar: safeAvatar,
    passed: finalPassed,
    vpnDetected,
    vpnType,
    botDetected,
    honeypotTriggered,
    accountAgeDays,
    clickMs,
    responseTimeMs,
    flagged,
    flagReason: reason,
    attempts: committedAttempts,
    cooldownUntil: committedCooldownUntil?.toISOString() ?? null,
    failureReason: !finalPassed ? reason : null,
    locked: committedLocked,
  };

  const outboxCte = terminal
    ? sql`queued AS (
        INSERT INTO bot_callback_outbox (reference_id, token, payload)
        SELECT ${row.referenceId}, ${input.token}, ${JSON.stringify(callbackPayload)}::jsonb
        FROM claimed
        ON CONFLICT (reference_id) DO NOTHING
        RETURNING id
      )`
    : sql`queued AS (SELECT NULL::integer AS id WHERE FALSE)`;
  const claimResult = await db.execute(sql`
    WITH state_claim AS (
      UPDATE verification_state
      SET attempts = ${committedAttempts},
          cooldown_until = ${committedCooldownUntil},
          locked_at = ${committedLocked ? now : null},
          last_reference_id = ${row.referenceId},
          updated_at = ${now}
      WHERE guild_id = ${row.guildId}
        AND user_id = ${row.userId}
        AND attempts = ${state.attempts}
        AND locked_at IS NULL
        AND (cooldown_until IS NULL OR cooldown_until <= ${now})
        AND EXISTS (
          SELECT 1 FROM verify_tokens
          WHERE token = ${input.token}
            AND discord_id = ${row.discordId}
            AND challenge_id = ${input.challengeId}
            AND used = FALSE
            AND challenge_consumed_at IS NULL
            AND challenge_claim_id IS NULL
            AND challenge_expires_at > ${now}
            AND expires_at > ${now}
        )
      RETURNING attempts
    ),
    claimed AS (
      UPDATE verify_tokens
      SET challenge_consumed_at = ${now},
          challenge_claim_id = ${claimId},
          challenge_submission_hash = ${submittedDigest},
          attempts = ${committedAttempts},
          used = ${terminal},
          status = ${callbackStatus},
          cooldown_until = ${committedCooldownUntil},
          failure_reason = ${reason},
          response_time_ms = ${responseTimeMs},
          discord_tag = ${safeTag},
          discord_avatar = ${safeAvatar},
          ip_address = ${input.observedIp || null},
          vpn_detected = ${vpnDetected},
          vpn_type = ${vpnType},
          flagged = ${flagged},
          flag_reason = ${reason},
          completed_at = ${finalPassed ? now : null},
          bot_error = ${terminal ? "Callback pending" : null}
      WHERE token = ${input.token}
        AND discord_id = ${row.discordId}
        AND challenge_id = ${input.challengeId}
        AND used = FALSE
        AND challenge_consumed_at IS NULL
        AND challenge_claim_id IS NULL
        AND challenge_expires_at > ${now}
        AND expires_at > ${now}
        AND EXISTS (SELECT 1 FROM state_claim)
      RETURNING token
    ),
    ${outboxCte}
    SELECT token FROM claimed
  `);
  const claimed = claimResult.rows as Array<{ token: string }>;
  if (!claimed.length) {
    const current = (
      await db.select().from(verifyTokens).where(eq(verifyTokens.token, input.token)).limit(1)
    )[0];
    if (
      current?.challengeId === input.challengeId &&
      current.challengeConsumedAt &&
      current.challengeSubmissionHash === submittedDigest
    ) {
      const currentState = await ensureVerificationState(db, row.guildId, row.userId, now);
      return {
        success: true,
        passed: Boolean(current.completedAt),
        status: current.status,
        referenceId: current.referenceId,
        attempts: currentState?.attempts ?? current.attempts,
        cooldownUntil: currentState?.cooldownUntil?.toISOString() ?? null,
        failureReason: current.failureReason,
        locked: Boolean(currentState?.lockedAt) || (currentState?.attempts ?? 0) >= 3,
        idempotent: true,
      };
    }
    return { success: false, error: "challenge_already_consumed", httpStatus: 409 };
  }

  if (flagged) {
    try {
      await db
        .insert(suspiciousAttempts)
        .values({
          guildId: row.guildId,
          userId: row.discordId,
          discordTag: safeTag,
          ipAddress: input.observedIp || null,
          vpnType,
          accountAgeDays,
          clickMs,
          reason,
        })
        .onConflictDoUpdate({
          target: [suspiciousAttempts.guildId, suspiciousAttempts.userId],
          set: {
            attemptCount: sql`${suspiciousAttempts.attemptCount} + 1`,
            lastAttemptAt: now,
            ipAddress: input.observedIp || null,
            vpnType,
            accountAgeDays,
            clickMs,
            reason,
          },
        });
    } catch (error) {
      console.error(
        "[callback] Suspicious-attempt audit write failed:",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  try {
    await db.insert(auditLogs).values({
      guildId: row.guildId,
      userId: row.discordId,
      discordTag: safeTag,
      eventType: event,
      severity: flagged ? "warn" : "info",
      ipAddress: input.observedIp || null,
      vpnDetected,
      accountAgeDays,
      clickMs,
      flagged,
      flagReason: reason,
      metadata: {
        attempts: committedAttempts,
        passed: finalPassed,
        botDetected,
        honeypotTriggered,
        challengeId: input.challengeId,
        callbackQueued: terminal,
      },
    });
  } catch (error) {
    console.error(
      "[callback] Verification audit write failed:",
      error instanceof Error ? error.name : "unknown",
    );
  }

  return {
    success: true,
    passed: finalPassed,
    status: callbackStatus,
    referenceId: row.referenceId,
    attempts: committedAttempts,
    cooldownUntil: committedCooldownUntil?.toISOString() ?? null,
    failureReason: reason,
    locked: committedLocked,
  };
}
