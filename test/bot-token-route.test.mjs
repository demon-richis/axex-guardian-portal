import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/lib/db/schema.ts";
import { handleBotTokenRequest } from "../src/routes/api/bot.token.ts";

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
  "0012_verification_rules_acknowledgement.sql",
];
const TEST_API_KEY = "unit-test-api-key-only";

async function applyMigration(client, name) {
  const contents = await readFile(join(root, "drizzle", name), "utf8");
  await client.exec(contents.replaceAll("--> statement-breakpoint", ""));
}

async function freshDb({ through = migrationFiles.length } = {}) {
  const client = new PGlite();
  for (const migration of migrationFiles.slice(0, through)) await applyMigration(client, migration);
  return { client, db: drizzle(client, { schema }) };
}

function dependencies(db, overrides = {}) {
  return {
    validateApiKey(request) {
      return request.headers.get("x-api-key") === TEST_API_KEY
        ? null
        : Response.json({ error: "Unauthorized" }, { status: 401 });
    },
    getDb: () => db,
    auditLogs: schema.auditLogs,
    verifyTokens: schema.verifyTokens,
    verificationState: schema.verificationState,
    ...overrides,
  };
}

function validRequest(overrides = {}, headers = { "x-api-key": TEST_API_KEY }) {
  return new Request("https://portal.test/api/bot/token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      token: "mock-token-123",
      userId: "123456789012345678",
      guildId: "234567890123456789",
      guildName: "Isolated Test Guild",
      guildMemberCount: 12,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ...overrides,
    }),
  });
}

async function withCapturedErrors(run) {
  const originalError = console.error;
  const entries = [];
  console.error = (...args) =>
    entries.push(
      args
        .map((value) =>
          value && typeof value === "object" ? JSON.stringify(value) : String(value),
        )
        .join(" "),
    );
  try {
    return { result: await run(), entries };
  } finally {
    console.error = originalError;
  }
}

test("token creation succeeds against the current isolated schema", async () => {
  const { client, db } = await freshDb();
  try {
    const response = await handleBotTokenRequest(validRequest(), dependencies(db));
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.token, "mock-token-123");
    assert.match(data.referenceId, /^AX-[0-9A-F]{32}$/);
    const rows = await db.select().from(schema.verifyTokens);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, "123456789012345678");
    assert.equal(rows[0].guildId, "234567890123456789");
  } finally {
    await client.close();
  }
});

test("reusing an active token extends its expiry when a longer member timeout is configured", async () => {
  const { client, db } = await freshDb();
  try {
    const firstExpiry = new Date(Date.now() + 10 * 60 * 1000);
    const first = await handleBotTokenRequest(
      validRequest({ token: "short-lived-token", expiresAt: firstExpiry.toISOString() }),
      dependencies(db),
    );
    assert.equal(first.status, 200);

    const requestedExpiry = new Date(Date.now() + 90 * 60 * 1000);
    const response = await handleBotTokenRequest(
      validRequest({
        token: "replacement-token",
        expiresAt: requestedExpiry.toISOString(),
      }),
      dependencies(db),
    );
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.reused, true);
    assert.equal(data.token, "short-lived-token");
    assert.equal(new Date(data.expiresAt).getTime(), requestedExpiry.getTime());
    const [stored] = await db.select().from(schema.verifyTokens);
    assert.equal(stored.expiresAt.getTime(), requestedExpiry.getTime());
  } finally {
    await client.close();
  }
});

test("token creation stores the validated policy on the token and verification state", async () => {
  const { client, db } = await freshDb();
  try {
    const policy = {
      maxAttempts: 2,
      cooldownsSeconds: [60, 3600],
      vpnAction: "flag",
      honeypotAction: "ban",
      newAccountDays: 14,
      newAccountAction: "review_flag",
      networkFailMode: "open_flag",
      verifyTimeoutSeconds: 120,
      reviewEnabled: true,
      reviewTimeoutHours: 48,
      raidAction: "stricter_attempts",
      autoVerifyEnabled: false,
    };
    const response = await handleBotTokenRequest(
      validRequest({ policy }),
      dependencies(db, { policyPersistenceEnabled: true }),
    );
    assert.equal(response.status, 200);
    const tokenRow = (await db.select().from(schema.verifyTokens))[0];
    const stateRow = (await db.select().from(schema.verificationState))[0];
    assert.deepEqual(tokenRow.policy, policy);
    assert.deepEqual(stateRow.policy, policy);
  } finally {
    await client.close();
  }
});

test("token creation stores the bot's initial level and trusted signals", async () => {
  const { client, db } = await freshDb();
  try {
    const response = await handleBotTokenRequest(
      validRequest({
        level: "medium",
        autoCandidate: true,
        profileSignals: { avatarDecoration: true },
        riskSignals: { defaultAvatar: false, raidBurst: false },
      }),
      dependencies(db),
    );
    assert.equal(response.status, 200);
    const [row] = await db.select().from(schema.verifyTokens);
    assert.equal(row.initialLevel, "medium");
    assert.equal(row.level, "medium");
    assert.equal(row.autoCandidate, true);
    assert.deepEqual(row.profileSignals, { avatarDecoration: true });
    assert.deepEqual(row.riskSignals, { defaultAvatar: false, raidBurst: false });
  } finally {
    await client.close();
  }
});

test("token creation rejects unknown levels and profile signal keys", async () => {
  const noDatabase = dependencies(null, {
    getDb() {
      assert.fail("invalid levels must not touch the database");
    },
  });
  assert.equal(
    (await handleBotTokenRequest(validRequest({ level: "trusted" }), noDatabase)).status,
    400,
  );
  assert.equal(
    (
      await handleBotTokenRequest(
        validRequest({ profileSignals: { avatarDecoration: true, arbitrary: true } }),
        noDatabase,
      )
    ).status,
    400,
  );
});

test("policy persistence is disabled when the deploy-safety gate is off", async () => {
  const { client, db } = await freshDb();
  try {
    const response = await handleBotTokenRequest(
      validRequest({ policy: { maxAttempts: 2 } }),
      dependencies(db, { policyPersistenceEnabled: false }),
    );
    assert.equal(response.status, 200);
    const tokenRow = (await db.select().from(schema.verifyTokens))[0];
    const stateRow = (await db.select().from(schema.verificationState))[0];
    assert.equal(tokenRow.policy, null);
    assert.equal(stateRow.policy, null);
  } finally {
    await client.close();
  }
});

test("out-of-bounds policy values are rejected before database access", async () => {
  const response = await handleBotTokenRequest(
    validRequest({
      policy: {
        maxAttempts: 99,
        cooldownsSeconds: [180, 10800],
        vpnAction: "block",
        honeypotAction: "quarantine",
        newAccountDays: 7,
        newAccountAction: "flag",
        networkFailMode: "closed",
        verifyTimeoutSeconds: 60,
        reviewEnabled: false,
        reviewTimeoutHours: 24,
        raidAction: "flag",
        autoVerifyEnabled: false,
      },
    }),
    dependencies(null, {
      getDb() {
        assert.fail("invalid policy must not touch the database");
      },
    }),
  );
  assert.equal(response.status, 400);
});

test("omitting migration 0004 reproduces a durable-state schema mismatch", async () => {
  const { client, db } = await freshDb({ through: 3 });
  try {
    const { result: response, entries } = await withCapturedErrors(() =>
      handleBotTokenRequest(validRequest({ token: "pre-0003-token" }), dependencies(db)),
    );
    assert.equal(response.status, 500);
    const diagnostic = entries.join(" ");
    assert.match(diagnostic, /verification_state_lookup/);
    assert.match(diagnostic, /"sqlState":"42P01"/);
    assert.doesNotMatch(diagnostic, /pre-0003-token/);
  } finally {
    await client.close();
  }
});

test("invalid API authentication returns 401 before database access", async () => {
  let databaseCalls = 0;
  const response = await handleBotTokenRequest(
    validRequest({}, { "x-api-key": "wrong-key" }),
    dependencies(null, {
      getDb() {
        databaseCalls += 1;
        throw new Error("database must not be touched");
      },
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(databaseCalls, 0);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("invalid JSON and invalid request fields remain 400 responses", async () => {
  const noDatabase = dependencies(null, {
    getDb() {
      assert.fail("invalid request must not touch the database");
    },
  });
  const invalidJson = await handleBotTokenRequest(
    new Request("https://portal.test/api/bot/token", {
      method: "POST",
      headers: { "x-api-key": TEST_API_KEY },
      body: "not-json",
    }),
    noDatabase,
  );
  const invalidField = await handleBotTokenRequest(
    validRequest({ expiresAt: "not-a-date" }),
    noDatabase,
  );
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidField.status, 400);
});

test("database initialization failure returns 500 with sanitized stage diagnostics", async () => {
  const { result: response, entries } = await withCapturedErrors(() =>
    handleBotTokenRequest(
      validRequest(),
      dependencies(null, {
        getDb() {
          throw new Error("secret DATABASE_URL must not be logged");
        },
      }),
    ),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.match(entries.join(" "), /database_initialization/);
  assert.match(entries.join(" "), /"errorName":"Error"/);
  assert.doesNotMatch(entries.join(" "), /secret DATABASE_URL/);
});

test("an outdated schema produces a reproducible SQLSTATE and active-lookup stage", async () => {
  const { client, db } = await freshDb({ through: 1 });
  try {
    const { result: response, entries } = await withCapturedErrors(() =>
      handleBotTokenRequest(validRequest(), dependencies(db)),
    );
    assert.equal(response.status, 500);
    const diagnostic = entries.join(" ");
    assert.match(diagnostic, /verification_state_lookup/);
    assert.match(diagnostic, /"sqlState":"42P01"/);
    assert.doesNotMatch(diagnostic, /mock-token-123|123456789012345678/);
  } finally {
    await client.close();
  }
});
