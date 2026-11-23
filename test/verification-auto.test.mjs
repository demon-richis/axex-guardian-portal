import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/lib/db/schema.ts";
import { attemptAutoVerification } from "../src/lib/verification-auto.server.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationFiles = [
  "0000_outgoing_azazel.sql",
  "0001_lowly_silver_samurai.sql",
  "0002_absent_goblin_queen.sql",
  "0003_server_verified_challenge_outbox.sql",
  "0004_durable_verification_state.sql",
  "0005_turnstile_challenge_timing.sql",
  "0006_shared_rate_limits_and_ip_cache.sql",
  "0007_lock_legacy_exhausted_verification_state.sql",
  "0008_bot_case_codes.sql",
  "0009_verification_policy.sql",
  "0010_audit_logs_ip_window.sql",
  "0011_verification_levels.sql",
];

async function freshDb() {
  const client = new PGlite();
  for (const name of migrationFiles) {
    const contents = await readFile(join(root, "drizzle", name), "utf8");
    await client.exec(contents.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

function snowflakeFrom(date) {
  return (((BigInt(date.getTime()) - 1_420_070_400_000n) << 22n) + 1n).toString();
}

async function seedCandidate(db, now, overrides = {}) {
  const discordId = snowflakeFrom(new Date(now.getTime() - 3 * 86_400_000));
  const policy = {
    maxAttempts: 3,
    cooldownsSeconds: [180, 10_800],
    vpnAction: "block",
    honeypotAction: "quarantine",
    newAccountDays: 7,
    newAccountAction: "flag",
    networkFailMode: "closed",
    verifyTimeoutSeconds: 60,
    reviewEnabled: false,
    reviewTimeoutHours: 24,
    raidAction: "flag",
    autoVerifyEnabled: true,
  };
  await db.insert(schema.verifyTokens).values({
    token: "auto-candidate-token",
    userId: discordId,
    guildId: "test-guild",
    guildName: "Test Guild",
    expiresAt: new Date(now.getTime() + 60_000),
    used: false,
    status: "pending",
    referenceId: "AX-AUTOVERIFY01",
    discordId,
    discordUsername: "test-user",
    discordAvatar: "avatar-hash",
    initialLevel: "medium",
    level: "medium",
    autoCandidate: true,
    profileSignals: { avatarDecoration: true },
    riskSignals: {},
    policy,
    ...overrides,
  });
  return discordId;
}

test("eligible OAuth-bound auto candidate completes only after a clear network check", async () => {
  const { client, db } = await freshDb();
  try {
    const now = new Date();
    await seedCandidate(db, now);
    let checkedIp;
    const result = await attemptAutoVerification(
      db,
      "auto-candidate-token",
      "198.51.100.10",
      { premiumType: 2 },
      async (ip) => {
        checkedIp = ip;
        return { status: "clear", isVPN: false };
      },
      now,
    );
    assert.deepEqual(result, { completed: true, level: "auto" });
    assert.equal(checkedIp, "198.51.100.10");
    const [token] = await db.select().from(schema.verifyTokens);
    const [callback] = await db.select().from(schema.botCallbackOutbox);
    assert.equal(token.status, "bot_update_pending");
    assert.equal(token.level, "auto");
    assert.equal(token.used, true);
    assert.equal(callback.payload.passed, true);
    assert.equal(callback.payload.autoVerified, true);
    assert.equal(callback.payload.profileSignals.nitro, true);
  } finally {
    await client.close();
  }
});

test("VPN and unknown network outcomes never complete auto verification", async () => {
  for (const network of [
    { status: "blocked", isVPN: true },
    { status: "unavailable", isVPN: false },
    { status: "clear", isVPN: false, flagged: true },
  ]) {
    const { client, db } = await freshDb();
    try {
      const now = new Date();
      await seedCandidate(db, now);
      const result = await attemptAutoVerification(
        db,
        "auto-candidate-token",
        "198.51.100.10",
        {},
        async () => network,
        now,
      );
      assert.equal(result.completed, false);
      const [token] = await db.select().from(schema.verifyTokens);
      assert.equal(token.used, false);
      assert.equal(token.status, "pending");
      assert.equal((await db.select().from(schema.botCallbackOutbox)).length, 0);
    } finally {
      await client.close();
    }
  }
});
