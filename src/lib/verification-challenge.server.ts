import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { verifyTokens } from "./db/schema.ts";
import { ensureVerificationState } from "./verification-state.server.ts";

type PortalDb = ReturnType<typeof getDb>;

type PublicChallenge = {
  challengeId: string;
  prompt: string;
  options: string[];
  expiresAt: string;
};

type ChallengeResult =
  | { success: true; challenge: PublicChallenge }
  | {
      success: false;
      error: "invalid_token" | "identity_required" | "expired" | "used" | "locked" | "cooldown";
      attempts?: number;
      cooldownUntil?: string;
    };

function digestAnswer(
  challengeId: string,
  answer: string,
  token: string,
  discordId: string,
  guildId: string,
): Buffer {
  return createHash("sha256")
    .update(
      `${token}\u0000${discordId}\u0000${guildId}\u0000${challengeId}\u0000${answer.normalize("NFKC").trim().toLowerCase()}`,
    )
    .digest();
}

export function hashChallengeAnswer(
  challengeId: string,
  answer: string,
  token: string,
  discordId: string,
  guildId: string,
): string {
  return digestAnswer(challengeId, answer, token, discordId, guildId).toString("hex");
}

export function answerMatches(
  challengeId: string,
  answer: string,
  storedDigest: string,
  context: { token: string; discordId: string; guildId: string },
): boolean {
  if (!challengeId || typeof answer !== "string" || answer.length > 80 || !storedDigest)
    return false;
  const candidate = digestAnswer(
    challengeId,
    answer,
    context.token,
    context.discordId,
    context.guildId,
  );
  let expected: Buffer;
  try {
    expected = Buffer.from(storedDigest, "hex");
  } catch {
    return false;
  }
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function createChallenge(): { prompt: string; options: string[]; answer: string } {
  const left = randomInt(12, 89);
  const right = randomInt(7, 58);
  const answer = String(left + right);
  const candidates = new Set([answer]);
  while (candidates.size < 4) {
    const offset = randomInt(2, 15) * (randomInt(0, 2) === 0 ? -1 : 1);
    const distractor = left + right + offset;
    if (distractor >= 0) candidates.add(String(distractor));
  }
  const options = [...candidates];
  for (let index = options.length - 1; index > 0; index -= 1) {
    const other = randomInt(0, index + 1);
    [options[index], options[other]] = [options[other]!, options[index]!];
  }
  return { prompt: `What is ${left} + ${right}?`, options, answer };
}

function publicChallenge(row: {
  challengeId: string | null;
  challengePrompt: string | null;
  challengeOptions: string[] | null;
  challengeExpiresAt: Date | null;
}): PublicChallenge | null {
  if (
    !row.challengeId ||
    !row.challengePrompt ||
    !row.challengeOptions ||
    !row.challengeExpiresAt
  ) {
    return null;
  }
  return {
    challengeId: row.challengeId,
    prompt: row.challengePrompt,
    options: row.challengeOptions,
    expiresAt: row.challengeExpiresAt.toISOString(),
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
  if (row.used) return { success: false, error: "used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { success: false, error: "expired" };
  if (row.status === "locked" || state.lockedAt || state.attempts >= 3) {
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

  const active = publicChallenge(row);
  if (active && !row.challengeConsumedAt && row.challengeExpiresAt!.getTime() > now.getTime()) {
    return { success: true, challenge: active };
  }

  const generated = createChallenge();
  const challengeId = randomBytes(24).toString("hex");
  const challengeExpiresAt = new Date(
    Math.min(row.expiresAt.getTime(), now.getTime() + 2 * 60 * 1000),
  );
  const updated = await db
    .update(verifyTokens)
    .set({
      challengeId,
      challengeAnswerHash: hashChallengeAnswer(
        challengeId,
        generated.answer,
        token,
        row.discordId,
        row.guildId,
      ),
      challengePrompt: generated.prompt,
      challengeOptions: generated.options,
      challengeExpiresAt,
      challengeConsumedAt: null,
      challengeClaimId: null,
    })
    .where(
      and(
        eq(verifyTokens.token, token),
        eq(verifyTokens.discordId, row.discordId),
        eq(verifyTokens.used, false),
        gt(verifyTokens.expiresAt, now),
        sql`${verifyTokens.attempts} < 3`,
        or(isNull(verifyTokens.cooldownUntil), lte(verifyTokens.cooldownUntil, now)),
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
        prompt: generated.prompt,
        options: generated.options,
        expiresAt: challengeExpiresAt.toISOString(),
      },
    };
  }

  // A concurrent request may have created the active challenge first. Return that
  // challenge rather than overwriting it or issuing multiple live proofs.
  const latest = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  const latestChallenge = latest && publicChallenge(latest);
  if (
    latest &&
    latestChallenge &&
    !latest.used &&
    !latest.challengeConsumedAt &&
    latest.challengeExpiresAt!.getTime() > now.getTime()
  ) {
    return { success: true, challenge: latestChallenge };
  }
  return { success: false, error: "cooldown", attempts: latest?.attempts ?? row.attempts };
}
