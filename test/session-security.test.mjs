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
    "test-nonce",
  );
  const api = applySecurityHeaders(
    request("https://portal.test/api/challenge"),
    new Response("{}", { status: 200 }),
    "test-nonce",
  );
  for (const response of [page, api]) {
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /script-src 'self' 'nonce-test-nonce' https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
    assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline|frame-src[^;]*'none'/);
    assert.equal(
      response.headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains; preload",
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
    validateRuntimeEnvironment(
      {
        NODE_ENV: "production",
        SESSION_SECRET: "a".repeat(32),
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
        DATABASE_URL: "postgresql://portal.test/db",
        BOT_TO_PORTAL_KEY: "b".repeat(32),
        PORTAL_TO_BOT_KEY: "p".repeat(32),
        BOT_WEBHOOK_URL: "https://bot.test/callback",
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_CLIENT_SECRET: "client-secret",
        DISCORD_REDIRECT_URI: "https://portal.test/api/auth/callback",
        CRON_SECRET: "c".repeat(32),
        TRUSTED_PROXY_MODE: "vercel",
        RATE_LIMIT_BACKEND: "neon",
        INTELLIGENCE_URL: "https://intelligence.test",
        INTELLIGENCE_API_KEY: "intelligence-key",
      },
      true,
    ),
  );
  assert.doesNotThrow(() => validateRuntimeEnvironment({ NODE_ENV: "development" }, false));
  assert.throws(
    () =>
      validateRuntimeEnvironment(
        {
          NODE_ENV: "production",
          SESSION_SECRET: "a".repeat(32),
          TURNSTILE_SITE_KEY: "site-key",
          TURNSTILE_SECRET_KEY: "secret-key",
          DATABASE_URL: "postgresql://portal.test/db",
          BOT_TO_PORTAL_KEY: "b".repeat(32),
          PORTAL_TO_BOT_KEY: "p".repeat(32),
          BOT_WEBHOOK_URL: "https://bot.test/callback",
          DISCORD_CLIENT_ID: "client-id",
          DISCORD_CLIENT_SECRET: "client-secret",
          DISCORD_REDIRECT_URI: "https://portal.test/api/auth/callback",
          CRON_SECRET: "c".repeat(32),
          TRUSTED_PROXY_MODE: "vercel",
          INTELLIGENCE_URL: "https://intelligence.test",
          INTELLIGENCE_API_KEY: "intelligence-key",
          RATE_LIMIT_BACKEND: "memory",
        },
        true,
      ),
    /RATE_LIMIT_BACKEND/,
  );
});

test.after(() => {
  if (secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
});
