import { randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { verifyTokens } from "./db/schema.ts";
import { ensureVerificationState } from "./verification-state.server.ts";
import { turnstileContext } from "./turnstile.server.ts";
import { policyForVerificationLevel } from "./verification-policy.server.ts";

type PortalDb = ReturnType<typeof getDb>;

type PublicChallenge = {
  challengeId: string;
  expiresAt: string;
  turnstileCData: string;
};

type ChallengeResult =
  | {
      success: true;
      challenge: PublicChallenge;
      level: "auto" | "low" | "medium" | "high" | "critical";
    }
  | {
      success: false;
      error:
        | "invalid_token"
        | "identity_required"
        | "expired"
        | "used"
        | "locked"
        | "cooldown"
        | "rules_ack_required";
      attempts?: number;
      cooldownUntil?: string;
    };

function publicChallenge(row: {
  token: string;
  discordId: string | null;
  guildId: string;
  challengeId: string | null;
  challengeIssuedAt: Date | null;
  challengeExpiresAt: Date | null;
}): PublicChallenge | null {
  if (!row.challengeId || !row.discordId || !row.challengeIssuedAt || !row.challengeExpiresAt) {
    return null;
  }
  return {
    challengeId: row.challengeId,
    expiresAt: row.challengeExpiresAt.toISOString(),
    turnstileCData: turnstileContext(row.token, row.discordId, row.guildId, row.challengeId),
  };
}

export async function issueVerificationChallenge(
  db: PortalDb,
  token: string,
  now = new Date(),
): Promise<ChallengeResult> {
  const row = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  if (!row) return { success: false, error: "invalid_token" };
  const state = await ensureVerificationState(db, row.guildId, row.userId, now);
  if (!state) return { success: false, error: "invalid_token" };
  const policy = policyForVerificationLevel(row.policy ?? state.policy, row.level);
  if (row.used) return { success: false, error: "used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { success: false, error: "expired" };
  if (row.status === "locked" || state.lockedAt || state.attempts >= policy.maxAttempts) {
    return { success: false, error: "locked", attempts: state.attempts };
  }
  if (state.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) {
    return {
      success: false,
      error: "cooldown",
      attempts: state.attempts,
      cooldownUntil: state.cooldownUntil.toISOString(),
    };
  }
  if (!row.discordId || row.discordId !== row.userId) {
    return { success: false, error: "identity_required" };
  }
  if (row.level === "medium" && !row.rulesAcknowledgedAt) {
    return { success: false, error: "rules_ack_required" };
  }

  const active = publicChallenge(row);
  if (active && !row.challengeConsumedAt && row.challengeExpiresAt!.getTime() > now.getTime()) {
    return { success: true, challenge: active, level: row.level };
  }

  const challengeId = randomBytes(24).toString("hex");
  const challengeExpiresAt = new Date(
    Math.min(row.expiresAt.getTime(), now.getTime() + 2 * 60 * 1000),
  );
  const updated = await db
    .update(verifyTokens)
    .set({
      challengeId,
      challengeAnswerHash: null,
      challengePrompt: null,
      challengeOptions: null,
      challengeIssuedAt: now,
      challengeExpiresAt,
      challengeConsumedAt: null,
      challengeClaimId: null,
      responseTimeMs: null,
    })
    .where(
      and(
        eq(verifyTokens.token, token),
        eq(verifyTokens.discordId, row.discordId),
        eq(verifyTokens.used, false),
        gt(verifyTokens.expiresAt, now),
        or(
          isNull(verifyTokens.challengeId),
          isNotNull(verifyTokens.challengeConsumedAt),
          isNull(verifyTokens.challengeExpiresAt),
          lte(verifyTokens.challengeExpiresAt, now),
        ),
      ),
    )
    .returning({ challengeId: verifyTokens.challengeId });

  if (updated.length) {
    return {
      success: true,
      challenge: {
        challengeId,
        expiresAt: challengeExpiresAt.toISOString(),
        turnstileCData: turnstileContext(token, row.discordId, row.guildId, challengeId),
      },
      level: row.level,
    };
  }

  const latest = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  const latestChallenge = latest && publicChallenge({ ...latest, token });
  if (
    latest &&
    latestChallenge &&
    !latest.used &&
    !latest.challengeConsumedAt &&
    latest.challengeExpiresAt!.getTime() > now.getTime()
  ) {
    return { success: true, challenge: latestChallenge, level: latest.level };
  }
  return { success: false, error: "cooldown", attempts: state.attempts };
}
