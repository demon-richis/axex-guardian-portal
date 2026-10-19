import assert from "node:assert/strict";
import test from "node:test";
import { Route as discordRoute } from "../src/routes/api/auth.discord.ts";
import { Route as callbackRoute } from "../src/routes/api/auth.callback.ts";
import { createOAuthState } from "../src/lib/session.server.ts";

const originalEnvironment = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
};
const originalFetch = globalThis.fetch;
process.env.SESSION_SECRET = "oauth-route-unit-test-secret-at-least-32-bytes";
process.env.DISCORD_CLIENT_ID = "discord-client-id";
process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";

const discordGet = discordRoute.options.server.handlers.GET;
const callbackGet = callbackRoute.options.server.handlers.GET;

function assertSecureCookie(cookie) {
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
}

test("Discord OAuth GET returns a redirect and signed state cookie", async () => {
  const response = await discordGet({
    request: new Request("https://portal.test/api/auth/discord?token=verification-token"),
  });
  const location = new URL(response.headers.get("location"));
  const cookie = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 302);
  assert.equal(location.origin, "https://discord.com");
  assert.equal(location.pathname, "/oauth2/authorize");
  assert.ok(location.searchParams.get("state"));
  assertSecureCookie(cookie);
});

test("OAuth callback GET clears state after a mocked Discord exchange failure", async () => {
  const state = createOAuthState("verification-token");
  globalThis.fetch = async () => new Response("{}", { status: 400 });

  try {
    const response = await callbackGet({
      request: new Request(
        `https://portal.test/api/auth/callback?code=authorization-code&state=${encodeURIComponent(state.nonce)}`,
        { headers: { cookie: state.cookie.split(";")[0] } },
      ),
    });
    const location = new URL(response.headers.get("location"));
    const cookie = response.headers.get("set-cookie") ?? "";

    assert.equal(response.status, 302);
    assert.equal(location.pathname, "/verify");
    assert.equal(location.searchParams.get("token"), "verification-token");
    assert.equal(location.searchParams.get("error"), "auth");
    assert.match(cookie, /Max-Age=0/i);
    assertSecureCookie(cookie);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
