import assert from "node:assert/strict";
import test from "node:test";
import { notifyBotIntelligence } from "../src/lib/intelligence.server.ts";

const originalWebhookUrl = process.env.BOT_WEBHOOK_URL;
const originalPortalKey = process.env.PORTAL_TO_BOT_KEY;
const originalLegacyKey = process.env.AXEX_BOT_API_KEY;
const originalFetch = globalThis.fetch;

async function capturedKey() {
  let apiKey;
  globalThis.fetch = async (_url, init) => {
    apiKey = new Headers(init?.headers).get("x-api-key");
    return new Response(null, { status: 200 });
  };

  await notifyBotIntelligence("user-1", "guild-1", { riskScore: 10 }, "page_opened");
  return apiKey;
}

test("bot intelligence notifications prefer the portal-to-bot key", async () => {
  process.env.BOT_WEBHOOK_URL = "https://bot.test/webhook";
  process.env.PORTAL_TO_BOT_KEY = "portal-to-bot-key";
  process.env.AXEX_BOT_API_KEY = "legacy-key";

  assert.equal(await capturedKey(), "portal-to-bot-key");
});

test("bot intelligence notifications retain the legacy key fallback", async () => {
  process.env.BOT_WEBHOOK_URL = "https://bot.test/webhook";
  delete process.env.PORTAL_TO_BOT_KEY;
  process.env.AXEX_BOT_API_KEY = "legacy-key";

  assert.equal(await capturedKey(), "legacy-key");
});

test.after(() => {
  if (originalWebhookUrl === undefined) delete process.env.BOT_WEBHOOK_URL;
  else process.env.BOT_WEBHOOK_URL = originalWebhookUrl;
  if (originalPortalKey === undefined) delete process.env.PORTAL_TO_BOT_KEY;
  else process.env.PORTAL_TO_BOT_KEY = originalPortalKey;
  if (originalLegacyKey === undefined) delete process.env.AXEX_BOT_API_KEY;
  else process.env.AXEX_BOT_API_KEY = originalLegacyKey;
  globalThis.fetch = originalFetch;
});
