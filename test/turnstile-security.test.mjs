import assert from "node:assert/strict";
import test from "node:test";
import { mapTurnstileError, shouldSubmitTurnstileToken } from "../src/lib/turnstile-client.ts";
import { turnstileContext, verifyTurnstile } from "../src/lib/turnstile.server.ts";

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
});

test("empty Turnstile tokens are never submitted for server verification", () => {
  assert.equal(shouldSubmitTurnstileToken(""), false);
  assert.equal(shouldSubmitTurnstileToken("   "), false);
  assert.equal(shouldSubmitTurnstileToken("token"), true);
  assert.equal(shouldSubmitTurnstileToken(null), false);
  assert.equal(shouldSubmitTurnstileToken(undefined), false);
});
