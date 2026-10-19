import assert from "node:assert/strict";
import test from "node:test";
import { validateApiKey, validateCronSecret } from "../src/lib/api-auth.server.ts";

const TEST_KEY = "portal-unit-test-key-7f4d1";
const originalKey = process.env.AXEX_BOT_API_KEY;
const originalDirectionalKey = process.env.BOT_TO_PORTAL_KEY;
const originalCronSecret = process.env.CRON_SECRET;

function request(key) {
  return new Request("https://portal.test/api/bot/token", {
    method: "POST",
    headers: key === undefined ? {} : { "x-api-key": key },
  });
}

test("API key helper accepts only an exact configured key and rejects mismatched lengths safely", () => {
  process.env.AXEX_BOT_API_KEY = TEST_KEY;
  assert.equal(validateApiKey(request(TEST_KEY)), null);

  const wrongSameLength = "x".repeat(TEST_KEY.length);
  assert.equal(validateApiKey(request(wrongSameLength))?.status, 401);
  assert.equal(validateApiKey(request("short"))?.status, 401);
  assert.equal(validateApiKey(request())?.status, 401);
});

test("API key helper fails closed when the server key is not configured", () => {
  delete process.env.AXEX_BOT_API_KEY;
  delete process.env.BOT_TO_PORTAL_KEY;
  assert.equal(validateApiKey(request(TEST_KEY))?.status, 401);
});

test("directional portal key is accepted and the legacy key remains a fallback", () => {
  process.env.BOT_TO_PORTAL_KEY = "new-directional-key";
  process.env.AXEX_BOT_API_KEY = TEST_KEY;
  assert.equal(validateApiKey(request("new-directional-key")), null);
  assert.equal(validateApiKey(request(TEST_KEY)), null);
  assert.equal(validateApiKey(request("wrong-key"))?.status, 401);
});

test("cron authentication requires an exact bearer secret and fails closed when absent", () => {
  process.env.CRON_SECRET = "cron-test-secret-with-sufficient-entropy";
  assert.equal(
    validateCronSecret(
      new Request("https://portal.test/api/bot/outbox", {
        headers: { authorization: "Bearer cron-test-secret-with-sufficient-entropy" },
      }),
    ),
    null,
  );
  assert.equal(
    validateCronSecret(
      new Request("https://portal.test/api/bot/outbox", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    )?.status,
    401,
  );
  delete process.env.CRON_SECRET;
  assert.equal(
    validateCronSecret(
      new Request("https://portal.test/api/bot/outbox", {
        headers: { authorization: "Bearer cron-test-secret-with-sufficient-entropy" },
      }),
    )?.status,
    401,
  );
});

test.after(() => {
  if (originalKey === undefined) delete process.env.AXEX_BOT_API_KEY;
  else process.env.AXEX_BOT_API_KEY = originalKey;
  if (originalDirectionalKey === undefined) delete process.env.BOT_TO_PORTAL_KEY;
  else process.env.BOT_TO_PORTAL_KEY = originalDirectionalKey;
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});
