import assert from "node:assert/strict";
import test from "node:test";
import { turnstileContext, verifyTurnstile } from "../src/lib/turnstile.server.ts";

const context = {
  token: "verification-token",
  discordId: "discord-user",
  guildId: "guild-id",
  challengeId: "a".repeat(48),
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
    Response.json({ success: true, action: "axex_verify", cdata: "wrong-context" }),
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
