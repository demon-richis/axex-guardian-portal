import assert from "node:assert/strict";
import test from "node:test";
import {
  createOAuthState,
  createSessionCookie,
  consumeOAuthState,
  verifySession,
} from "../src/lib/session.server.ts";
import { applySecurityHeaders, validateRuntimeEnvironment } from "../src/lib/security.ts";

const secret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-bytes";

function request(url, headers = {}) {
  return new Request(url, { headers });
}

test("OAuth state rejects missing, mismatched, and expired signed state cookies", () => {
  const state = createOAuthState("verification-token", 1_700_000_000_000);
  assert.equal(
    consumeOAuthState(
      request("https://portal.test/api/auth/callback"),
      state.nonce,
      1_700_000_000_001,
    ),
    null,
  );
  assert.equal(
    consumeOAuthState(
      request("https://portal.test/api/auth/callback", { cookie: state.cookie.split(";")[0] }),
      "wrong-nonce",
      1_700_000_000_001,
    ),
    null,
  );
  assert.deepEqual(
    consumeOAuthState(
      request("https://portal.test/api/auth/callback", { cookie: state.cookie.split(";")[0] }),
      state.nonce,
      1_700_000_000_001,
    )?.token,
    "verification-token",
  );
  assert.equal(
    consumeOAuthState(
      request("https://portal.test/api/auth/callback", { cookie: state.cookie.split(";")[0] }),
      state.nonce,
      1_700_000_601_000,
    ),
    null,
  );
});

test("verification sessions reject missing and mismatched token or Discord identity", () => {
  const cookie = createSessionCookie("verification-token", "discord-user", 1_700_000_000_000);
  assert.equal(
    verifySession(
      request("https://portal.test/api/challenge"),
      "verification-token",
      undefined,
      1_700_000_000_001,
    ),
    false,
  );
  const headers = { cookie: cookie.split(";")[0] };
  assert.equal(
    verifySession(
      request("https://portal.test/api/challenge", headers),
      "other-token",
      undefined,
      1_700_000_000_001,
    ),
    false,
  );
  assert.equal(
    verifySession(
      request("https://portal.test/api/callback", headers),
      "verification-token",
      "other-user",
      1_700_000_000_001,
    ),
    false,
  );
  assert.equal(
    verifySession(
      request("https://portal.test/api/callback", headers),
      "verification-token",
      "discord-user",
      1_700_000_000_001,
    ),
    true,
  );
});

test("security headers cover pages and API responses", () => {
  const page = applySecurityHeaders(
    request("https://portal.test/verify"),
    new Response("page", { status: 200 }),
  );
  const api = applySecurityHeaders(
    request("https://portal.test/api/challenge"),
    new Response("{}", { status: 200 }),
  );
  for (const response of [page, api]) {
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(
      response.headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains",
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.ok(response.headers.get("permissions-policy"));
  }
  assert.equal(page.headers.get("cache-control"), null);
  assert.equal(api.headers.get("cache-control"), "no-store");
});

test("production startup validation requires a sufficiently strong session secret", () => {
  assert.throws(
    () => validateRuntimeEnvironment({ NODE_ENV: "production", SESSION_SECRET: "too-short" }, true),
    /SESSION_SECRET/,
  );
  assert.doesNotThrow(() =>
    validateRuntimeEnvironment({ NODE_ENV: "production", SESSION_SECRET: "a".repeat(32) }, true),
  );
  assert.doesNotThrow(() => validateRuntimeEnvironment({ NODE_ENV: "development" }, false));
});

test.after(() => {
  if (secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
});
