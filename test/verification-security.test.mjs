import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema.ts";
import { issueVerificationChallenge } from "../src/lib/verification-challenge.server.ts";
import { submitVerificationChallenge } from "../src/lib/verification-submit.server.ts";
import { processBotCallbackOutboxWith } from "../src/lib/bot-callback-outbox.server.ts";
import { verificationCallbackBody } from "../src/lib/verification-callback-body.ts";
import { bindOAuthIdentity } from "../src/lib/discord-identity.server.ts";
import { isSameOrigin } from "../src/lib/rate-limit.server.ts";
import { isReferenceIdCollision } from "../src/lib/reference-id.server.ts";
import { releaseVerificationState } from "../src/lib/verification-state.server.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(root, "drizzle");
const migrationFiles = [
  "0000_outgoing_azazel.sql",
  "0001_lowly_silver_samurai.sql",
  "0002_absent_goblin_queen.sql",
  "0003_server_verified_challenge_outbox.sql",
  "0004_durable_verification_state.sql",
  "0005_turnstile_challenge_timing.sql",
];

async function applyMigration(client, name) {
  const contents = await readFile(join(migrationDir, name), "utf8");
  await client.exec(contents.replaceAll("--> statement-breakpoint", ""));
}

async function freshDb({ through = migrationFiles.length } = {}) {
  const client = new PGlite();
  for (const migration of migrationFiles.slice(0, through)) await applyMigration(client, migration);
  return { client, db: drizzle(client, { schema }) };
}

function snowflakeFrom(date) {
  return (((BigInt(date.getTime()) - 1_420_071_776_000n) << 22n) + 1n).toString();
}

async function seedToken(
  db,
  {
    token = `test-${Math.random().toString(16).slice(2)}`,
    referenceId = `AX-${Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, "0")}`,
    userId,
    now = new Date(),
    expiresInMs = 60 * 60 * 1000,
    discordId = snowflakeFrom(new Date(now.getTime() - 30 * 86_400_000)),
  } = {},
) {
  const targetUserId = userId ?? discordId;
  await db.insert(schema.verifyTokens).values({
    token,
    userId: targetUserId,
    guildId: "test-guild",
    guildName: "Isolated Test Guild",
    expiresAt: new Date(now.getTime() + expiresInMs),
    used: false,
    status: "pending",
    referenceId,
    discordId,
    discordUsername: "staging-user",
    attempts: 0,
  });
  return { token, referenceId, discordId, userId: targetUserId };
}

async function challengeFor(db, token, now = new Date()) {
  const issued = await issueVerificationChallenge(db, token, now);
  assert.equal(
    issued.success,
    true,
    `Challenge issue error: ${issued.success ? "" : issued.error}`,
  );
  const row = (
    await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, token))
  )[0];
  assert.ok(row?.challengeIssuedAt);
  assert.ok(issued.challenge.turnstileCData);
  return { challenge: issued.challenge, correctAnswer: "turnstile-placeholder", row };
}

function submitInput(seed, challenge, answer, overrides = {}) {
  return {
    token: seed.token,
    challengeId: challenge.challengeId,
    answer,
    turnstileToken: "dev-bypass",
    discordId: seed.discordId,
    discordTag: "staging-user",
    clickMs: 8_000,
    observedIp: "198.51.100.14",
    isVpn: false,
    vpnTypeDetected: null,
    now: new Date(),
    ...overrides,
  };
}

test("challenge is random, server-bound, and duplicate issuance returns the same Turnstile context", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const first = await issueVerificationChallenge(db, seed.token);
    const repeated = await issueVerificationChallenge(db, seed.token);
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    assert.equal(first.success, true);
    assert.equal(repeated.success, true);
    assert.deepEqual(repeated.challenge, first.challenge);
    assert.match(first.challenge.challengeId, /^[a-f0-9]{48}$/);
    assert.equal(first.challenge.turnstileCData.length, 64);
    assert.equal(row.challengePrompt, null);
    assert.equal(row.challengeOptions, null);
    assert.equal(row.challengeAnswerHash, null);
    assert.ok(row.challengeIssuedAt);
    assert.ok(row.challengeExpiresAt.getTime() <= row.expiresAt.getTime());
  } finally {
    await client.close();
  }
});

test("callback request schema rejects passed=true and requires server-verifiable proof fields", () => {
  const proof = {
    token: "staging-token",
    challengeId: "a".repeat(48),
    turnstileToken: "turnstile-response",
  };
  assert.equal(verificationCallbackBody.safeParse(proof).success, true);
  assert.equal(verificationCallbackBody.safeParse({ ...proof, passed: true }).success, false);
  assert.equal(
    verificationCallbackBody.safeParse({ ...proof, ipAddress: "198.51.100.1" }).success,
    false,
  );
  assert.equal(
    verificationCallbackBody.safeParse({ token: "staging-token", passed: true }).success,
    false,
  );
});

test("browser-only challenge endpoints reject missing or foreign Origin headers", () => {
  assert.equal(
    isSameOrigin(
      new Request("https://portal.test/api/challenge", {
        headers: { Origin: "https://portal.test" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOrigin(
      new Request("https://portal.test/api/challenge", {
        headers: { Origin: "https://attacker.test" },
      }),
    ),
    false,
  );
  assert.equal(isSameOrigin(new Request("https://portal.test/api/challenge")), false);
});

test("reference collision retry detector recognizes only the designated nested Postgres constraint", () => {
  assert.equal(
    isReferenceIdCollision({
      cause: { code: "23505", constraint: "verify_tokens_reference_id_unique_idx" },
    }),
    true,
  );
  assert.equal(isReferenceIdCollision({ code: "23505", constraint: "verify_tokens_pkey" }), false);
  assert.equal(isReferenceIdCollision({ code: "08006", message: "database unavailable" }), false);
});

test("OAuth identity must equal the bot-issued Discord user and cannot be rebound", async () => {
  const { client, db } = await freshDb();
  try {
    const targetId = snowflakeFrom(new Date(Date.now() - 30 * 86_400_000));
    const seed = await seedToken(db, { userId: targetId, discordId: null });
    const attacker = await bindOAuthIdentity(db, seed.token, {
      id: "999999999999999999",
      username: "different-user",
      avatar: null,
    });
    assert.deepEqual(attacker, { success: false, reason: "identity_mismatch" });

    const intended = await bindOAuthIdentity(db, seed.token, {
      id: targetId,
      username: "intended-user",
      avatar: null,
    });
    assert.deepEqual(intended, { success: true });
    const rebound = await bindOAuthIdentity(db, seed.token, {
      id: "999999999999999999",
      username: "rebound-user",
      avatar: null,
    });
    assert.deepEqual(rebound, { success: false, reason: "identity_mismatch" });
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    assert.equal(row.discordId, targetId);

    const expiredSeed = await seedToken(db, {
      token: "expired-oauth-token",
      userId: targetId,
      discordId: null,
      now: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const expired = await bindOAuthIdentity(db, expiredSeed.token, {
      id: targetId,
      username: "intended-user",
      avatar: null,
    });
    assert.deepEqual(expired, { success: false, reason: "expired_or_used" });

    const legacyMismatch = await seedToken(db, {
      token: "legacy-mismatched-oauth",
      userId: targetId,
      discordId: "999999999999999999",
    });
    const noChallenge = await issueVerificationChallenge(db, legacyMismatch.token);
    assert.equal(noChallenge.success, false);
    assert.equal(noChallenge.error, "identity_required");
    const noSubmission = await submitVerificationChallenge(db, {
      token: legacyMismatch.token,
      challengeId: "a".repeat(48),
      answer: "42",
      discordId: legacyMismatch.discordId,
      observedIp: "198.51.100.14",
      isVpn: false,
      vpnTypeDetected: null,
    });
    assert.equal(noSubmission.error, "identity_mismatch");
  } finally {
    await client.close();
  }
});

test("missing or invalid Turnstile cannot bypass verification or consume an attempt", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge } = await challengeFor(db, seed.token);
    const missing = await submitVerificationChallenge(db, {
      ...submitInput(seed, challenge, "unused"),
      turnstileToken: "",
    });
    const invalid = await submitVerificationChallenge(db, {
      ...submitInput(seed, challenge, "unused"),
      turnstileToken: "forged-token",
    });
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    assert.deepEqual(missing, { success: false, error: "turnstile_invalid", httpStatus: 403 });
    assert.deepEqual(invalid, { success: false, error: "turnstile_invalid", httpStatus: 403 });
    assert.equal(row.attempts, 0);
    assert.equal(row.challengeConsumedAt, null);
  } finally {
    await client.close();
  }
});

test("Turnstile provider outage fails closed without consuming an attempt", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge } = await challengeFor(db, seed.token);
    const result = await submitVerificationChallenge(db, {
      ...submitInput(seed, challenge, "unused"),
      turnstileToken: "provider-response",
      turnstileEnvironment: { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "test-secret" },
      turnstileFetch: async () => {
        throw new Error("provider unavailable");
      },
    });
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    assert.deepEqual(result, {
      success: false,
      error: "turnstile_unavailable",
      httpStatus: 503,
    });
    assert.equal(row.attempts, 0);
    assert.equal(row.challengeConsumedAt, null);
  } finally {
    await client.close();
  }
});

test("client clickMs cannot make a valid Turnstile proof fail or pass", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge, row: issuedRow } = await challengeFor(db, seed.token);
    const result = await submitVerificationChallenge(
      db,
      submitInput(seed, challenge, "unused", { clickMs: 0, now: issuedRow.challengeIssuedAt }),
    );
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    assert.equal(result.passed, true);
    assert.equal(result.attempts, 1);
    assert.equal(row.responseTimeMs, 0);
  } finally {
    await client.close();
  }
});

test("Turnstile-passed but policy-failed attempts escalate and the third locks the session", async () => {
  const { client, db } = await freshDb();
  try {
    let now = new Date();
    const seed = await seedToken(db, {
      now,
      expiresInMs: 8 * 60 * 60 * 1000,
      discordId: snowflakeFrom(new Date(now.getTime() - 86_400_000)),
    });
    let result;
    for (let index = 0; index < 3; index += 1) {
      const { challenge } = await challengeFor(db, seed.token, now);
      result = await submitVerificationChallenge(
        db,
        submitInput(seed, challenge, "unused", { now }),
      );
      assert.equal(result.passed, false);
      assert.equal(result.attempts, index + 1);
      if (index < 2) {
        assert.ok(result.cooldownUntil, "each non-terminal wrong attempt must set a cooldown");
        const expectedMinimum = index === 0 ? 3 * 60_000 : 3 * 60 * 60_000;
        assert.ok(new Date(result.cooldownUntil).getTime() - now.getTime() >= expectedMinimum);
        now = new Date(new Date(result.cooldownUntil).getTime() + 1_000);
      }
    }
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    const outbox = await db.select().from(schema.botCallbackOutbox);
    assert.equal(result.locked, true);
    assert.equal(row.status, "bot_update_pending");
    assert.equal(row.attempts, 3);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].payload.passed, false);
  } finally {
    await client.close();
  }
});

test("correct challenge proof is identity-bound and atomically creates one final outbox callback", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge, correctAnswer } = await challengeFor(db, seed.token);
    const identityMismatch = await submitVerificationChallenge(
      db,
      submitInput(seed, challenge, correctAnswer, { discordId: "999999999999999999" }),
    );
    assert.equal(identityMismatch.success, false);
    assert.equal(identityMismatch.error, "identity_mismatch");

    const accepted = await submitVerificationChallenge(
      db,
      submitInput(seed, challenge, correctAnswer),
    );
    const duplicate = await submitVerificationChallenge(
      db,
      submitInput(seed, challenge, correctAnswer),
    );
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    const queued = await db.select().from(schema.botCallbackOutbox);
    assert.equal(accepted.passed, true);
    assert.equal(accepted.status, "bot_update_pending");
    assert.equal(accepted.attempts, 1);
    assert.equal(duplicate.idempotent, true);
    assert.equal(row.used, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].referenceId, seed.referenceId);
    assert.equal(queued[0].payload.passed, true);
    assert.equal(queued[0].payload.discordId, seed.discordId);
  } finally {
    await client.close();
  }
});

test("expired challenges and mismatched challenge IDs do not increment attempts", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge, correctAnswer } = await challengeFor(db, seed.token);
    const expired = await submitVerificationChallenge(
      db,
      submitInput(seed, challenge, correctAnswer, { now: new Date(Date.now() + 3 * 60 * 1000) }),
    );
    const wrongId = await submitVerificationChallenge(
      db,
      submitInput(seed, { ...challenge, challengeId: "a".repeat(48) }, correctAnswer),
    );
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    assert.equal(expired.error, "invalid_or_expired_challenge");
    assert.equal(wrongId.error, "invalid_or_expired_challenge");
    assert.equal(row.attempts, 0);
    assert.equal(row.challengeConsumedAt, null);
  } finally {
    await client.close();
  }
});

test("concurrent duplicate correct submissions produce one attempt and one durable callback", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge, correctAnswer } = await challengeFor(db, seed.token);
    const [first, second] = await Promise.all([
      submitVerificationChallenge(db, submitInput(seed, challenge, correctAnswer)),
      submitVerificationChallenge(db, submitInput(seed, challenge, correctAnswer)),
    ]);
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    const outbox = await db.select().from(schema.botCallbackOutbox);
    assert.ok(first.success && second.success);
    assert.equal(row.attempts, 1);
    assert.equal(outbox.length, 1);
    assert.ok(first.idempotent || second.idempotent);
  } finally {
    await client.close();
  }
});

test("outbox retries the identical payload/reference after uncertain delivery and completes status on acknowledgement", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db);
    const { challenge, correctAnswer } = await challengeFor(db, seed.token);
    const accepted = await submitVerificationChallenge(
      db,
      submitInput(seed, challenge, correctAnswer),
    );
    assert.equal(accepted.passed, true);
    const requestBodies = [];
    let calls = 0;
    const fetcher = async (_url, init) => {
      requestBodies.push(init.body);
      calls += 1;
      if (calls === 1) throw new Error("simulated response loss after remote receipt");
      return new Response("ok", { status: 200 });
    };
    const config = { webhookUrl: "https://staging.invalid/callback", apiKey: "test-only-key" };

    assert.deepEqual(await processBotCallbackOutboxWith(db, config, fetcher), {
      delivered: 0,
      retrying: 1,
    });
    await db
      .update(schema.botCallbackOutbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.botCallbackOutbox.token, seed.token));
    assert.deepEqual(await processBotCallbackOutboxWith(db, config, fetcher), {
      delivered: 1,
      retrying: 0,
    });

    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, seed.token))
    )[0];
    const outbox = (await db.select().from(schema.botCallbackOutbox))[0];
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0], requestBodies[1]);
    assert.equal(JSON.parse(requestBodies[0]).referenceId, seed.referenceId);
    assert.equal(outbox.status, "delivered");
    assert.equal(row.status, "completed");
    assert.ok(row.botAcknowledgedAt);
  } finally {
    await client.close();
  }
});

test("reference collision preflight aborts migration without changing existing active reference IDs", async () => {
  const { client, db } = await freshDb({ through: 3 });
  try {
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await client.query(
      `INSERT INTO verify_tokens (token, user_id, guild_id, guild_name, expires_at, reference_id, used)
       VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)`,
      [
        "legacy-one",
        "u1",
        "g1",
        "Guild",
        expiry,
        "AX-AAAA1111",
        false,
        "legacy-two",
        "u2",
        "g1",
        "Guild",
        expiry,
        "AX-AAAA1111",
        false,
      ],
    );
    await assert.rejects(() => applyMigration(client, migrationFiles[3]));
    const rows = await client.query("SELECT token, reference_id FROM verify_tokens ORDER BY token");
    const outbox = await client.query(
      "SELECT to_regclass('public.bot_callback_outbox') AS table_name",
    );
    const challengeColumn = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'verify_tokens' AND column_name = 'challenge_id'",
    );
    assert.deepEqual(
      rows.rows.map((row) => row.reference_id),
      ["AX-AAAA1111", "AX-AAAA1111"],
    );
    assert.equal(outbox.rows[0].table_name, null);
    assert.equal(challengeColumn.rows.length, 0);
  } finally {
    await client.close();
  }
});

test("new reference IDs remain bot-compatible and the database rejects duplicates", async () => {
  const { client, db } = await freshDb();
  try {
    const seed = await seedToken(db, { referenceId: "AX-1234ABCD" });
    assert.match(seed.referenceId, /^AX-[A-F0-9]{8}$/);
    await assert.rejects(() =>
      seedToken(db, { token: "other-token", referenceId: seed.referenceId }),
    );
  } finally {
    await client.close();
  }
});

test("durable verification state survives token expiry, locks across new tokens, and resets on release", async () => {
  const { client, db } = await freshDb();
  try {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const first = await seedToken(db, {
      token: "durable-state-1",
      now: start,
      expiresInMs: 8 * 60 * 60 * 1000,
      discordId: snowflakeFrom(new Date(start.getTime() - 86_400_000)),
    });
    const firstChallenge = await challengeFor(db, first.token, start);
    const failedOnce = await submitVerificationChallenge(
      db,
      submitInput(first, firstChallenge.challenge, "unused", { now: start }),
    );
    assert.equal(failedOnce.attempts, 1);

    const second = await seedToken(db, {
      token: "durable-state-2",
      referenceId: "AX-DURABLE02",
      userId: first.userId,
      discordId: first.discordId,
      now: start,
      expiresInMs: 8 * 60 * 60 * 1000,
    });
    const duringCooldown = await issueVerificationChallenge(
      db,
      second.token,
      new Date(start.getTime() + 1_000),
    );
    assert.equal(duringCooldown.success, false);
    assert.equal(duringCooldown.error, "cooldown");
    assert.equal(duringCooldown.attempts, 1);

    const afterFirstCooldown = new Date(start.getTime() + 3 * 60 * 1000 + 1);
    const secondChallenge = await challengeFor(db, second.token, afterFirstCooldown);
    const failedTwice = await submitVerificationChallenge(
      db,
      submitInput(second, secondChallenge.challenge, "unused", { now: afterFirstCooldown }),
    );
    assert.equal(failedTwice.attempts, 2);

    const third = await seedToken(db, {
      token: "durable-state-3",
      referenceId: "AX-DURABLE03",
      userId: first.userId,
      discordId: first.discordId,
      now: start,
      expiresInMs: 8 * 60 * 60 * 1000,
    });
    const stillCooling = await issueVerificationChallenge(
      db,
      third.token,
      new Date(start.getTime() + 10 * 60 * 1000 + 1),
    );
    assert.equal(stillCooling.success, false);
    assert.equal(stillCooling.error, "cooldown");
    assert.equal(stillCooling.attempts, 2);

    const afterSecondCooldown = new Date(afterFirstCooldown.getTime() + 3 * 60 * 60 * 1000 + 1);
    const thirdChallenge = await challengeFor(db, third.token, afterSecondCooldown);
    const locked = await submitVerificationChallenge(
      db,
      submitInput(third, thirdChallenge.challenge, "unused", { now: afterSecondCooldown }),
    );
    assert.equal(locked.attempts, 3);
    assert.equal(locked.locked, true);

    const fourth = await seedToken(db, {
      token: "durable-state-4",
      referenceId: "AX-DURABLE04",
      userId: first.userId,
      discordId: first.discordId,
      now: start,
      expiresInMs: 8 * 60 * 60 * 1000,
    });
    const blocked = await issueVerificationChallenge(
      db,
      fourth.token,
      new Date(afterSecondCooldown.getTime() + 1_000),
    );
    assert.equal(blocked.success, false);
    assert.equal(blocked.error, "locked");

    assert.equal(
      await releaseVerificationState(
        db,
        "test-guild",
        first.userId,
        new Date(afterSecondCooldown.getTime() + 2_000),
      ),
      true,
    );
    const released = await issueVerificationChallenge(
      db,
      fourth.token,
      new Date(afterSecondCooldown.getTime() + 2_000),
    );
    assert.equal(released.success, true);
    const state = (await db.select().from(schema.verificationState))[0];
    assert.equal(state.attempts, 0);
    assert.equal(state.lockedAt, null);
    assert.equal(state.cooldownUntil, null);
  } finally {
    await client.close();
  }
});
