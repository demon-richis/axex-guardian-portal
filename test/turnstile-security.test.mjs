import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema.ts";
import { issueVerificationChallenge } from "../src/lib/verification-challenge.server.ts";
import { submitVerificationChallenge } from "../src/lib/verification-submit.server.ts";
import { mapTurnstileError, shouldSubmitTurnstileToken } from "../src/lib/turnstile-client.ts";
import { turnstileContext, verifyTurnstile } from "../src/lib/turnstile.server.ts";
import { normalizePortalHostname, validateRuntimeEnvironment } from "../src/lib/security.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(root, "drizzle");
const migrationFiles = [
  "0000_outgoing_azazel.sql",
  "0001_lowly_silver_samurai.sql",
  "0002_absent_goblin_queen.sql",
  "0003_server_verified_challenge_outbox.sql",
  "0004_durable_verification_state.sql",
  "0005_turnstile_challenge_timing.sql",
  "0006_shared_rate_limits_and_ip_cache.sql",
  "0007_lock_legacy_exhausted_verification_state.sql",
];
const context = {
  token: "verification-token",
  discordId: "discord-user",
  guildId: "guild-id",
  challengeId: "a".repeat(48),
  requestHostname: "portal.test",
  remoteIp: "198.51.100.14",
};
const environment = {
  NODE_ENV: "production",
  TURNSTILE_SECRET_KEY: "turnstile-secret-for-test",
};

async function freshDb() {
  const client = new PGlite();
  for (const name of migrationFiles) {
    const contents = await readFile(join(migrationDir, name), "utf8");
    await client.exec(contents.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

function snowflakeFrom(date) {
  return (((BigInt(date.getTime()) - 1_420_071_776_000n) << 22n) + 1n).toString();
}

async function createSubmission(db) {
  const now = new Date();
  const discordId = snowflakeFrom(new Date(now.getTime() - 30 * 86_400_000));
  const token = `turnstile-test-${Math.random().toString(16).slice(2)}`;
  await db.insert(schema.verifyTokens).values({
    token,
    userId: discordId,
    guildId: "turnstile-test-guild",
    guildName: "Turnstile Test Guild",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    used: false,
    status: "pending",
    referenceId: "AX-12345678",
    discordId,
    discordUsername: "turnstile-user",
    attempts: 0,
  });
  const issued = await issueVerificationChallenge(db, token, now);
  assert.equal(issued.success, true);
  return {
    now,
    token,
    discordId,
    challengeId: issued.challenge.challengeId,
    input: {
      token,
      challengeId: issued.challenge.challengeId,
      answer: "unused",
      turnstileToken: "provider-response-token",
      discordId,
      discordTag: "turnstile-user",
      clickMs: 8_000,
      observedIp: "198.51.100.14",
      requestHostname: "portal.test",
      isVpn: false,
      vpnTypeDetected: null,
      now,
      turnstileEnvironment: environment,
    },
  };
}

async function readState(db, token, discordId) {
  const row = (
    await db.select().from(schema.verifyTokens).where(eq(schema.verifyTokens.token, token))
  )[0];
  const state = (
    await db
      .select()
      .from(schema.verificationState)
      .where(eq(schema.verificationState.userId, discordId))
  )[0];
  return { row, state };
}

test("Turnstile siteverify requires a response bound to the verification context", async () => {
  let requestBody;
  const result = await verifyTurnstile(
    "provider-token",
    context,
    environment,
    async (_url, init) => {
      requestBody = new URLSearchParams(init.body);
      return Response.json({
        success: true,
        action: "axex_verify",
        hostname: "portal.test",
        cdata: turnstileContext(
          context.token,
          context.discordId,
          context.guildId,
          context.challengeId,
        ),
      });
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(requestBody.get("secret"), environment.TURNSTILE_SECRET_KEY);
  assert.equal(requestBody.get("response"), "provider-token");
  assert.equal(requestBody.get("remoteip"), context.remoteIp);
});

test("Turnstile classifies provider configuration errors and duplicate tokens separately", async () => {
  for (const errorCode of [
    "missing-input-secret",
    "invalid-input-secret",
    "bad-request",
    "internal-error",
  ]) {
    const result = await verifyTurnstile("provider-token", context, environment, async () =>
      Response.json({ success: false, "error-codes": [errorCode] }),
    );
    assert.deepEqual(result, { ok: false, error: "turnstile_unavailable" }, errorCode);
  }
  const duplicate = await verifyTurnstile("provider-token", context, environment, async () =>
    Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
  );
  assert.deepEqual(duplicate, { ok: false, error: "turnstile_retry" });
  const invalidResponse = await verifyTurnstile("provider-token", context, environment, async () =>
    Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
  );
  assert.deepEqual(invalidResponse, { ok: false, error: "turnstile_invalid" });
  const nonOk = await verifyTurnstile(
    "provider-token",
    context,
    environment,
    async () => new Response(null, { status: 502 }),
  );
  assert.deepEqual(nonOk, { ok: false, error: "turnstile_unavailable" });
});

test("Turnstile failure logs one structured line without secrets or response tokens", async () => {
  const originalWarn = console.warn;
  const messages = [];
  console.warn = (message) => messages.push(message);
  try {
    await verifyTurnstile("private-provider-token", context, environment, async () =>
      Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(messages.length, 1);
  const entry = JSON.parse(messages[0]);
  assert.deepEqual(entry, {
    event: "turnstile_verify_failed",
    errorCodes: ["invalid-input-response"],
    expectedHostname: "portal.test",
    resultHostname: null,
    expectedAction: "axex_verify",
    resultAction: null,
    cdataMatched: false,
  });
  assert.equal(messages[0].includes("private-provider-token"), false);
  assert.equal(messages[0].includes(environment.TURNSTILE_SECRET_KEY), false);
});

test("Turnstile provider errors do not consume verification attempts or write a failure audit", async () => {
  const { client, db } = await freshDb();
  try {
    const submission = await createSubmission(db);
    const result = await submitVerificationChallenge(db, {
      ...submission.input,
      turnstileFetch: async () =>
        Response.json({ success: false, "error-codes": ["internal-error"] }),
    });
    const { row, state } = await readState(db, submission.token, submission.discordId);
    const audits = await db.select().from(schema.auditLogs);
    assert.deepEqual(result, {
      success: false,
      error: "turnstile_unavailable",
      httpStatus: 503,
    });
    assert.equal(row.attempts, 0);
    assert.equal(row.challengeConsumedAt, null);
    assert.equal(state.attempts, 0);
    assert.equal(audits.length, 0);
  } finally {
    await client.close();
  }
});

test("duplicate Turnstile tokens request a retry without consuming an attempt or audit", async () => {
  const { client, db } = await freshDb();
  try {
    const submission = await createSubmission(db);
    const result = await submitVerificationChallenge(db, {
      ...submission.input,
      turnstileFetch: async () =>
        Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    });
    const { row, state } = await readState(db, submission.token, submission.discordId);
    const audits = await db.select().from(schema.auditLogs);
    assert.deepEqual(result, { success: false, error: "turnstile_retry", httpStatus: 409 });
    assert.equal(row.attempts, 0);
    assert.equal(row.challengeConsumedAt, null);
    assert.equal(state.attempts, 0);
    assert.equal(audits.length, 0);
  } finally {
    await client.close();
  }
});

test("invalid Turnstile responses consume one attempt and create a failure audit", async () => {
  const { client, db } = await freshDb();
  try {
    const submission = await createSubmission(db);
    const result = await submitVerificationChallenge(db, {
      ...submission.input,
      turnstileFetch: async () =>
        Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    const { row, state } = await readState(db, submission.token, submission.discordId);
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.eventType, "WRONG_ANSWER"));
    assert.equal(result.success, true);
    assert.equal(result.passed, false);
    assert.equal(result.attempts, 1);
    assert.equal(row.attempts, 1);
    assert.equal(state.attempts, 1);
    assert.ok(row.challengeConsumedAt);
    assert.equal(audits.length, 1);
  } finally {
    await client.close();
  }
});

test("Turnstile rejects a provider response bound to another challenge context", async () => {
  const result = await verifyTurnstile("provider-token", context, environment, async () =>
    Response.json({
      success: true,
      action: "axex_verify",
      hostname: "portal.test",
      cdata: "wrong-context",
    }),
  );
  assert.deepEqual(result, { ok: false, error: "turnstile_invalid" });
});

test("Turnstile rejects a response for a hostname other than PORTAL_HOSTNAME", async () => {
  const result = await verifyTurnstile(
    "provider-token",
    context,
    { ...environment, PORTAL_HOSTNAME: "expected.test" },
    async () =>
      Response.json({
        success: true,
        action: "axex_verify",
        hostname: "portal.test",
        cdata: turnstileContext(
          context.token,
          context.discordId,
          context.guildId,
          context.challengeId,
        ),
      }),
  );
  assert.deepEqual(result, { ok: false, error: "turnstile_invalid" });
});

test("missing Turnstile response is invalid before contacting the provider", async () => {
  let contacted = false;
  const result = await verifyTurnstile("", context, environment, async () => {
    contacted = true;
    return Response.json({ success: true });
  });
  assert.deepEqual(result, { ok: false, error: "turnstile_invalid" });
  assert.equal(contacted, false);
});

test("mapTurnstileError converts server error codes into user-facing states", () => {
  assert.deepEqual(mapTurnstileError("invalid_request"), {
    kind: "turnstileInvalidRequest",
    title: "Security check was blocked",
    description: "The challenge request was invalid. Please refresh and try again.",
  });
  assert.deepEqual(mapTurnstileError("rate_limited", 8), {
    kind: "turnstileRateLimited",
    title: "Too many requests",
    description: "Please wait 8 seconds before trying again.",
    retryAfterSeconds: 8,
  });
  assert.deepEqual(mapTurnstileError("verification_unavailable"), {
    kind: "captchaUnavailable",
    title: "Verification service unavailable",
    description:
      "The secure challenge provider is temporarily unavailable. No attempt was used; please try again shortly.",
  });
  assert.deepEqual(mapTurnstileError("invalid_or_expired_challenge"), {
    kind: "turnstileExpired",
    title: "Challenge expired",
    description: "The security challenge expired; please complete it again.",
  });
  assert.deepEqual(mapTurnstileError("turnstile_retry"), {
    kind: "turnstileRetry",
    title: "Check again",
    description: "Please complete the check again.",
  });
});

test("empty Turnstile tokens are never submitted for server verification", () => {
  assert.equal(shouldSubmitTurnstileToken(""), false);
  assert.equal(shouldSubmitTurnstileToken("   "), false);
  assert.equal(shouldSubmitTurnstileToken("token"), true);
  assert.equal(shouldSubmitTurnstileToken(null), false);
  assert.equal(shouldSubmitTurnstileToken(undefined), false);
});

test("PORTAL_HOSTNAME normalization accepts hostnames without origin syntax", () => {
  assert.equal(normalizePortalHostname("https://x.vercel.app/"), "x.vercel.app");
  assert.equal(normalizePortalHostname("X.vercel.app:443"), "x.vercel.app");
  assert.equal(normalizePortalHostname("x.vercel.app."), "x.vercel.app");
});

test("runtime validation rejects a PORTAL_HOSTNAME containing a scheme or path", () => {
  assert.throws(
    () =>
      validateRuntimeEnvironment({
        NODE_ENV: "development",
        PORTAL_HOSTNAME: "https://x.vercel.app/",
      }),
    /PORTAL_HOSTNAME must contain only a hostname/,
  );
});
