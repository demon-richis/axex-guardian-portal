import { eq, sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { auditLogs, verifyTokens } from "./db/schema.ts";
import { ensureVerificationState } from "./verification-state.server.ts";
import { policyForToken } from "./verification-policy.server.ts";
import {
  ProfileSignalsSchema,
  RiskSignalsSchema,
  classifyVerificationLevel,
  maxVerificationLevel,
  type ProfileSignals,
  type RiskSignals,
} from "./verification-level.server.ts";

type PortalDb = ReturnType<typeof getDb>;

export type AutoVerificationNetworkResult = {
  status: "clear" | "blocked" | "unavailable";
  isVPN: boolean;
  flagged?: boolean;
  type?: string | null;
};

export type OAuthProfileSignals = {
  premiumType?: number | null;
  banner?: string | null;
  avatarDecoration?: boolean;
  bio?: string | null;
  intelligenceRecommendation?: string | null;
};

type AutoVerificationResult = {
  completed: boolean;
  level: "auto" | "low" | "medium" | "high" | "critical";
};

function accountAgeDays(discordId: string, now: Date): number | null {
  try {
    const createdAt = new Date(Number(BigInt(discordId) >> 22n) + 1_420_070_400_000);
    if (!Number.isFinite(createdAt.getTime())) return null;
    return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
  } catch {
    return null;
  }
}

function mergedProfileSignals(
  tokenSignals: unknown,
  oauthSignals: OAuthProfileSignals,
): ProfileSignals {
  const parsed = ProfileSignalsSchema.safeParse(tokenSignals ?? {});
  const profile: ProfileSignals = parsed.success ? parsed.data : {};
  return {
    ...profile,
    ...(oauthSignals.avatarDecoration === true ? { avatarDecoration: true } : {}),
    ...(typeof oauthSignals.premiumType === "number" && oauthSignals.premiumType > 0
      ? { nitro: true }
      : {}),
    ...(oauthSignals.banner ? { banner: true } : {}),
    ...(oauthSignals.bio ? { bio: true } : {}),
  };
}

export async function attemptAutoVerification(
  db: PortalDb,
  token: string,
  observedIp: string,
  oauthSignals: OAuthProfileSignals,
  checkNetwork: (ip: string) => Promise<AutoVerificationNetworkResult>,
  now = new Date(),
): Promise<AutoVerificationResult> {
  const row = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  if (!row || row.used || row.expiresAt.getTime() <= now.getTime() || !row.referenceId) {
    return { completed: false, level: row?.level ?? "low" };
  }

  const policy = policyForToken(row.policy);
  const state = await ensureVerificationState(db, row.guildId, row.userId, now);
  if (!state) return { completed: false, level: row.level };

  const profileSignals = mergedProfileSignals(row.profileSignals, oauthSignals);
  const parsedRiskSignals = RiskSignalsSchema.safeParse(row.riskSignals ?? {});
  const riskSignals: RiskSignals = parsedRiskSignals.success ? parsedRiskSignals.data : {};
  const ageDays = accountAgeDays(row.discordId ?? "", now);
  const initialLevel =
    row.initialLevel === "auto" ||
    row.initialLevel === "low" ||
    row.initialLevel === "medium" ||
    row.initialLevel === "high" ||
    row.initialLevel === "critical"
      ? row.initialLevel
      : "low";
  if (ageDays === null || !row.discordId) return { completed: false, level: row.level };

  const effectiveRiskSignals = {
    ...riskSignals,
    defaultAvatar: riskSignals.defaultAvatar || !row.discordAvatar,
  };
  const observedLevel = classifyVerificationLevel({
    initialLevel,
    accountAgeDays: ageDays,
    newAccountDays: policy.newAccountDays,
    riskSignals: effectiveRiskSignals,
    vpnDetected: false,
    ...(oauthSignals.intelligenceRecommendation !== undefined
      ? { intelligenceRecommendation: oauthSignals.intelligenceRecommendation }
      : {}),
  });
  const effectiveLevel = maxVerificationLevel(row.level, observedLevel);
  const canAttemptAuto =
    policy.autoVerifyEnabled &&
    row.autoCandidate &&
    row.discordId === row.userId &&
    state.attempts === 0 &&
    !state.lockedAt &&
    (!state.cooldownUntil || state.cooldownUntil.getTime() <= now.getTime()) &&
    !(ageDays < policy.newAccountDays && policy.newAccountAction === "block");
  if (!canAttemptAuto) {
    await db
      .update(verifyTokens)
      .set({ level: effectiveLevel, profileSignals })
      .where(eq(verifyTokens.token, token));
    return { completed: false, level: effectiveLevel };
  }

  const computedLevel = classifyVerificationLevel({
    initialLevel,
    accountAgeDays: ageDays,
    newAccountDays: policy.newAccountDays,
    riskSignals: effectiveRiskSignals,
    vpnDetected: false,
    ...(oauthSignals.intelligenceRecommendation !== undefined
      ? { intelligenceRecommendation: oauthSignals.intelligenceRecommendation }
      : {}),
    allowAuto: true,
    autoCandidate: row.autoCandidate,
    profileSignals,
  });
  if (computedLevel !== "auto") {
    await db
      .update(verifyTokens)
      .set({ level: maxVerificationLevel(effectiveLevel, computedLevel), profileSignals })
      .where(eq(verifyTokens.token, token));
    return { completed: false, level: maxVerificationLevel(effectiveLevel, computedLevel) };
  }

  const network = await checkNetwork(observedIp);
  if (network.status !== "clear" || network.isVPN || network.flagged) {
    const escalatedLevel = classifyVerificationLevel({
      initialLevel,
      accountAgeDays: ageDays,
      newAccountDays: policy.newAccountDays,
      riskSignals: effectiveRiskSignals,
      vpnDetected: network.isVPN || network.flagged === true,
      ...(oauthSignals.intelligenceRecommendation !== undefined
        ? { intelligenceRecommendation: oauthSignals.intelligenceRecommendation }
        : {}),
      allowAuto: false,
    });
    const finalLevel = maxVerificationLevel(effectiveLevel, escalatedLevel);
    await db
      .update(verifyTokens)
      .set({ level: finalLevel, profileSignals })
      .where(eq(verifyTokens.token, token));
    return { completed: false, level: finalLevel };
  }

  const payload = {
    guildId: row.guildId,
    referenceId: row.referenceId,
    caseCode: row.caseCode ?? null,
    userId: row.discordId,
    discordId: row.discordId,
    discordTag: row.discordTag ?? row.discordUsername,
    discordAvatar: row.discordAvatar,
    passed: true,
    vpnDetected: false,
    vpnType: network.type ?? null,
    botDetected: false,
    honeypotTriggered: false,
    accountAgeDays: ageDays,
    clickMs: null,
    responseTimeMs: null,
    flagged: false,
    flagReason: null,
    attempts: 0,
    cooldownUntil: null,
    failureReason: null,
    locked: false,
    level: "auto",
    autoVerified: true,
    profileSignals,
  };

  const result = await db.execute(sql`
    WITH claimed AS (
      UPDATE verify_tokens
      SET used = TRUE,
          status = 'bot_update_pending',
          level = 'auto',
          completed_at = ${now},
          ip_address = ${observedIp || null},
          vpn_detected = FALSE,
          vpn_type = NULL,
          flagged = FALSE,
          flag_reason = NULL,
          attempts = 0,
          profile_signals = ${JSON.stringify(profileSignals)}::jsonb,
          bot_error = 'Callback pending'
      WHERE token = ${token}
        AND user_id = ${row.userId}
        AND discord_id = ${row.discordId}
        AND used = FALSE
        AND status IN ('pending', 'failed')
        AND expires_at > ${now}
        AND reference_id = ${row.referenceId}
        AND EXISTS (
          SELECT 1 FROM verification_state
          WHERE guild_id = ${row.guildId}
            AND user_id = ${row.userId}
            AND attempts = 0
            AND locked_at IS NULL
            AND (cooldown_until IS NULL OR cooldown_until <= ${now})
        )
      RETURNING token, reference_id
    ),
    queued AS (
      INSERT INTO bot_callback_outbox (reference_id, token, payload)
      SELECT ${row.referenceId}, claimed.token, ${JSON.stringify(payload)}::jsonb
      FROM claimed
      ON CONFLICT (reference_id) DO NOTHING
      RETURNING id
    ),
    audited AS (
      INSERT INTO audit_logs (
        guild_id, user_id, discord_tag, event_type, severity, ip_address,
        account_age_days, flagged, metadata, created_at
      )
      SELECT
        ${row.guildId}, ${row.discordId}, ${row.discordTag ?? row.discordUsername},
        'AUTO_VERIFIED', 'info', ${observedIp || null}, ${ageDays}, FALSE,
        ${JSON.stringify({ referenceId: row.referenceId, profileSignals })}::jsonb, ${now}
      FROM claimed
      RETURNING id
    )
    SELECT claimed.token FROM claimed
    WHERE EXISTS (SELECT 1 FROM queued)
  `);
  const completed = (result.rows as Array<{ token: string }>).length > 0;
  if (!completed) {
    const latest = (
      await db
        .select({ level: verifyTokens.level })
        .from(verifyTokens)
        .where(eq(verifyTokens.token, token))
        .limit(1)
    )[0];
    return { completed: false, level: latest?.level ?? computedLevel };
  }

  return { completed: true, level: "auto" };
}
