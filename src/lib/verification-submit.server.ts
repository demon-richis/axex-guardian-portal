import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { auditLogs, suspiciousAttempts, verifyTokens } from "./db/schema.ts";
import { ensureVerificationState } from "./verification-state.server.ts";
import { verifyTurnstile } from "./turnstile.server.ts";
import {
  cooldownSecondsForAttempt,
  policyForVerificationLevel,
} from "./verification-policy.server.ts";
import {
  RiskSignalsSchema,
  classifyVerificationLevel,
  maxVerificationLevel,
} from "./verification-level.server.ts";

type PortalDb = ReturnType<typeof getDb>;

export type ChallengeSubmission = {
  token: string;
  challengeId: string;
  answer?: string | undefined;
  turnstileToken?: string | undefined;
  orbitToken?: string | undefined;
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
  networkFlagged?: boolean | undefined;
  networkFlagReason?: string | null | undefined;
  intelligenceRecommendation?: string | null | undefined;
  riskSignals?: unknown;
  turnstileFetch?: typeof fetch | undefined;
  turnstileEnvironment?: NodeJS.ProcessEnv | undefined;
  now?: Date | undefined;
};

export type SubmissionResult = {
  success: boolean;
  passed?: boolean;
  status?: string;
  level?: string;
  referenceId?: string | null;
  caseCode?: string | null;
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
  const policy = policyForVerificationLevel(row.policy ?? state.policy, row.level);

  const submittedDigest = createHash("sha256")
    .update(
      `${input.token}\u0000${row.discordId ?? ""}\u0000${row.guildId}\u0000${input.challengeId}\u0000${input.turnstileToken ?? input.orbitToken ?? ""}`,
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
      level: row.level,
      referenceId: row.referenceId,
      caseCode: row.caseCode,
      attempts: state.attempts,
      cooldownUntil: state.cooldownUntil?.toISOString() ?? null,
      failureReason: row.failureReason,
      locked: Boolean(state.lockedAt) || state.attempts >= policy.maxAttempts,
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
  if (row.level === "medium" && !row.rulesAcknowledgedAt) {
    return { success: false, error: "rules_ack_required", httpStatus: 403 };
  }
  if (row.challengeId === input.challengeId && row.challengeConsumedAt) {
    return { success: false, error: "challenge_already_consumed", httpStatus: 409 };
  }
  if (row.status === "locked" || state.lockedAt || state.attempts >= policy.maxAttempts) {
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
  let proofCorrect = false;
  let proofError: string | null = null;
  let orbitEnabled = false;
  if (row.level === "high") {
    try {
      const orbit = await import("./orbit.server.ts");
      orbitEnabled = orbit.orbitEnabled();
    } catch {
      orbitEnabled = false;
    }
  }
  if (row.level === "high" && orbitEnabled) {
    if (!input.orbitToken || input.turnstileToken || !row.discordId) {
      return { success: false, error: "invalid_challenge_provider", httpStatus: 400 };
    }
    try {
      const { verifyOrbitProof } = await import("./orbit.server.ts");
      proofCorrect = await verifyOrbitProof(input.orbitToken, row.discordId, row.guildId);
      if (!proofCorrect) proofError = "orbit_invalid";
    } catch (error) {
      console.error(
        "[verification] Orbit proof verification unavailable:",
        error instanceof Error ? error.message : "unknown error",
      );
      proofError = "turnstile_unavailable";
    }
  } else {
    if (!input.turnstileToken || input.orbitToken) {
      return { success: false, error: "invalid_challenge_provider", httpStatus: 400 };
    }
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
    proofCorrect = turnstile.ok;
    if (!turnstile.ok) proofError = turnstile.error;
  }
  if (proofError === "turnstile_unavailable" || proofError === "turnstile_retry") {
    return {
      success: false,
      error: proofError,
      httpStatus: proofError === "turnstile_retry" ? 409 : 503,
    };
  }
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
            sql`select count(distinct ${auditLogs.userId}) as count from ${auditLogs} where ${auditLogs.guildId} = ${row.guildId} and ${auditLogs.ipAddress} = ${input.observedIp} and ${auditLogs.createdAt} > ${new Date(now.getTime() - 72 * 60 * 60 * 1000)}`,
          )
        ).rows[0]?.["count"] ?? 0,
      )
    : 0;
  const parsedRiskSignals = RiskSignalsSchema.safeParse(row.riskSignals ?? {});
  const suppliedRiskSignals = RiskSignalsSchema.safeParse(input.riskSignals ?? {});
  const riskSignals = {
    ...(parsedRiskSignals.success ? parsedRiskSignals.data : {}),
    ...(suppliedRiskSignals.success ? suppliedRiskSignals.data : {}),
  };
  const calculatedLevel = classifyVerificationLevel({
    initialLevel: row.initialLevel,
    accountAgeDays,
    newAccountDays: policy.newAccountDays,
    riskSignals: {
      ...riskSignals,
      defaultAvatar: riskSignals.defaultAvatar || !row.discordAvatar,
      sharedIp: riskSignals.sharedIp || sameIpUsers >= 3,
    },
    vpnDetected,
    honeypotTriggered,
    ...(input.intelligenceRecommendation !== undefined
      ? { intelligenceRecommendation: input.intelligenceRecommendation }
      : {}),
  });
  const level = maxVerificationLevel(row.level, calculatedLevel);
  const escalatedToHigh = level === "high" && row.level !== "high";
  if (escalatedToHigh) {
    await db
      .update(verifyTokens)
      .set({ level })
      .where(and(eq(verifyTokens.token, input.token), eq(verifyTokens.used, false)));
  }
  const newAccount = accountAgeDays < policy.newAccountDays;
  const automaticReason = riskSignals.confirmedAltOfBanned
    ? "Confirmed banned-user alt"
    : riskSignals.knownBadIp
      ? "Known-bad IP"
      : riskSignals.blocklistHit
        ? "Blocklist hit"
        : honeypotTriggered
          ? "Hidden verification trap activated"
          : riskSignals.flaggedUserAlt
            ? "Flagged-user alt"
            : riskSignals.raidBurst
              ? "Raid burst active"
              : level === "high" && row.level !== "high"
                ? "High-assurance verification is unavailable"
                : input.networkFlagged
                  ? (input.networkFlagReason ?? "Network check unavailable")
                  : vpnDetected
                    ? "VPN or proxy detected"
                    : riskSignals.suspiciousUsername
                      ? "Suspicious username"
                      : riskSignals.sharedIp || sameIpUsers >= 3
                        ? "Shared IP used by multiple users"
                        : newAccount
                          ? "New Discord account"
                          : attempts >= 2
                            ? "Repeated verification attempt"
                            : null;
  const flagged = Boolean(automaticReason);
  const vpnTerminal = vpnDetected && policy.vpnAction === "block";
  const honeypotTerminal = honeypotTriggered && policy.honeypotAction !== "flag";
  const newAccountTerminal = newAccount && policy.newAccountAction === "block";
  const proofAccepted =
    proofCorrect &&
    !escalatedToHigh &&
    !vpnTerminal &&
    !honeypotTerminal &&
    !newAccountTerminal &&
    level !== "critical";
  const reviewRequired = proofAccepted && level === "high" && policy.reviewEnabled;
  const finalPassed = proofAccepted && !reviewRequired;
  const accepted = finalPassed || reviewRequired;
  const locked =
    !accepted &&
    (attempts >= policy.maxAttempts || vpnTerminal || honeypotTerminal || newAccountTerminal);
  const terminal =
    accepted ||
    escalatedToHigh ||
    locked ||
    vpnTerminal ||
    honeypotTerminal ||
    newAccountTerminal ||
    level === "critical";
  const cooldownUntil = terminal
    ? null
    : new Date(now.getTime() + cooldownSecondsForAttempt(policy, attempts) * 1000);
  const committedAttempts = accepted ? 0 : attempts;
  const committedCooldownUntil = accepted ? null : cooldownUntil;
  const committedLocked = accepted ? false : locked;
  const event = botDetected
    ? "BOT_DETECTED"
    : vpnDetected
      ? "VPN_BLOCKED"
      : finalPassed
        ? "VERIFIED"
        : reviewRequired
          ? "REVIEW_PENDING"
          : "WRONG_ANSWER";
  const reason = reviewRequired
    ? "MANUAL_REVIEW_PENDING"
    : (automaticReason ?? (finalPassed ? null : (input.failureReason ?? event)));
  const callbackStatus = terminal ? "bot_update_pending" : "failed";
  const claimId = randomUUID();
  const safeTag = input.discordTag ?? row.discordTag ?? row.discordUsername;
  const safeAvatar = input.discordAvatar ?? row.discordAvatar;
  const callbackPayload = {
    guildId: row.guildId,
    referenceId: row.referenceId,
    caseCode: row.caseCode ?? null,
    userId: row.discordId,
    discordId: row.discordId,
    discordTag: safeTag,
    discordAvatar: safeAvatar,
    passed: finalPassed,
    reviewRequired,
    reviewTimeoutHours: policy.reviewTimeoutHours,
    vpnDetected,
    vpnType,
    botDetected,
    honeypotTriggered,
    honeypotAction: policy.honeypotAction,
    accountAgeDays,
    clickMs,
    responseTimeMs,
    flagged,
    flagReason: reason,
    attempts: committedAttempts,
    cooldownUntil: committedCooldownUntil?.toISOString() ?? null,
    failureReason: !finalPassed && !reviewRequired ? reason : null,
    locked: committedLocked,
    level,
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
          status = ${reviewRequired ? "pending_review" : callbackStatus},
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
          level = ${level},
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
        level: current.level,
        referenceId: current.referenceId,
        attempts: currentState?.attempts ?? current.attempts,
        cooldownUntil: currentState?.cooldownUntil?.toISOString() ?? null,
        failureReason: current.failureReason,
        locked:
          Boolean(currentState?.lockedAt) || (currentState?.attempts ?? 0) >= policy.maxAttempts,
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
        passed: accepted,
        botDetected,
        honeypotTriggered,
        challengeId: input.challengeId,
        callbackQueued: terminal,
        level,
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
    passed: accepted,
    status: reviewRequired ? "pending_review" : callbackStatus,
    level,
    referenceId: row.referenceId,
    caseCode: row.caseCode ?? null,
    attempts: committedAttempts,
    cooldownUntil: committedCooldownUntil?.toISOString() ?? null,
    failureReason: reason,
    locked: committedLocked,
  };
}
