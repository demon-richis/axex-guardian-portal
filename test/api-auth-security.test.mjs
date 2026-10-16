import assert from "node:assert/strict";
import test from "node:test";
import { validateApiKey } from "../src/lib/api-auth.server.ts";

const TEST_KEY = "portal-unit-test-key-7f4d1";
const originalKey = process.env.AXEX_BOT_API_KEY;

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
  assert.equal(validateApiKey(request(TEST_KEY))?.status, 401);
});

test.after(() => {
  if (originalKey === undefined) delete process.env.AXEX_BOT_API_KEY;
  else process.env.AXEX_BOT_API_KEY = originalKey;
});
