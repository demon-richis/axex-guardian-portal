import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/lib/db/schema.ts";
import { isCaseCode, isCaseCodeCollision } from "../src/lib/case-code.server.ts";
import { snowflakeToTimestamp } from "../src/lib/discord-snowflake.ts";
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
];
const KEY = "unit-test-api-key-only";

async function freshDb() {
  const client = new PGlite();
  for (const name of migrationFiles) {
    const contents = await readFile(join(root, "drizzle", name), "utf8");
    await client.exec(contents.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

function deps(db) {
  return {
    validateApiKey: (request) =>
      request.headers.get("x-api-key") === KEY
        ? null
        : Response.json({ error: "Unauthorized" }, { status: 401 }),
    getDb: () => db,
    auditLogs: schema.auditLogs,
    verifyTokens: schema.verifyTokens,
    verificationState: schema.verificationState,
  };
}

function req(overrides = {}) {
  return new Request("https://portal.test/api/bot/token", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({
      token: "token-a",
      userId: "111111111111111111",
      guildId: "222222222222222222",
      guildName: "Case Guild",
      guildMemberCount: 5,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ...overrides,
    }),
  });
}

async function quiet(run) {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("bot-assigned case code is stored and returned alongside the portal reference", async () => {
  const { client, db } = await freshDb();
  try {
    const response = await quiet(() =>
      handleBotTokenRequest(req({ caseCode: "48151623" }), deps(db)),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.caseCode, "48151623");
    assert.match(body.referenceId, /^AX-[0-9A-F]{32}$/);
    const row = (
      await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, "token-a"))
    )[0];
    assert.equal(row.caseCode, "48151623");
  } finally {
    await client.close();
  }
});

test("requests without a case code still work and return null", async () => {
  const { client, db } = await freshDb();
  try {
    const response = await quiet(() => handleBotTokenRequest(req(), deps(db)));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.caseCode, null);
  } finally {
    await client.close();
  }
});

test("malformed case codes are rejected before touching the database", async () => {
  const { client, db } = await freshDb();
  try {
    for (const caseCode of ["1234567", "123456789", "01234567", "abcdefgh", "1234 567", ""]) {
      const response = await quiet(() => handleBotTokenRequest(req({ caseCode }), deps(db)));
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(caseCode)}`);
    }
    assert.equal((await db.select().from(schema.verifyTokens)).length, 0);
  } finally {
    await client.close();
  }
});

test("a case code is unique per server: conflict returns 409, another server may reuse it", async () => {
  const { client, db } = await freshDb();
  try {
    await quiet(() => handleBotTokenRequest(req({ caseCode: "48151623" }), deps(db)));
    const sameGuild = await quiet(() =>
      handleBotTokenRequest(
        req({ token: "token-b", userId: "333333333333333333", caseCode: "48151623" }),
        deps(db),
      ),
    );
    assert.equal(sameGuild.status, 409);
    assert.deepEqual(await sameGuild.json(), { error: "case_code_conflict" });
    assert.equal((await db.select().from(schema.verifyTokens)).length, 1);

    const otherGuild = await quiet(() =>
      handleBotTokenRequest(
        req({
          token: "token-c",
          userId: "333333333333333333",
          guildId: "444444444444444444",
          caseCode: "48151623",
        }),
        deps(db),
      ),
    );
    assert.equal(otherGuild.status, 200);
  } finally {
    await client.close();
  }
});

test("re-issuing for the same user keeps the original token and case code", async () => {
  const { client, db } = await freshDb();
  try {
    await quiet(() => handleBotTokenRequest(req({ caseCode: "48151623" }), deps(db)));
    const again = await quiet(() =>
      handleBotTokenRequest(req({ token: "token-new", caseCode: "99999999" }), deps(db)),
    );
    const body = await again.json();
    assert.equal(again.status, 200);
    assert.equal(body.reused, true);
    assert.equal(body.token, "token-a");
    assert.equal(body.caseCode, "48151623");
  } finally {
    await client.close();
  }
});

test("case code helpers validate the 8-digit format and detect only the designated index", () => {
  assert.equal(isCaseCode("12345678"), true);
  assert.equal(isCaseCode("02345678"), false);
  assert.equal(isCaseCode("1234567"), false);
  assert.equal(isCaseCode(12345678), false);
  const collision = {
    cause: { code: "23505", constraint: "verify_tokens_guild_case_code_unique_idx" },
  };
  assert.equal(isCaseCodeCollision(collision), true);
  assert.equal(
    isCaseCodeCollision({ code: "23505", constraint: "verify_tokens_reference_id_unique_idx" }),
    false,
  );
});

test("snowflakeToTimestamp decodes real Discord IDs and rejects non-snowflakes", () => {
  // Example snowflake from the Discord developer documentation.
  assert.equal(snowflakeToTimestamp("175928847299117063"), 1462015105796);
  assert.equal(
    snowflakeToTimestamp("1486679343009632287"),
    Number((1486679343009632287n >> 22n) + 1420070400000n),
  );
  assert.equal(snowflakeToTimestamp("123"), null);
  assert.equal(snowflakeToTimestamp("abc123456789012345"), null);
  assert.equal(snowflakeToTimestamp(null), null);
});
