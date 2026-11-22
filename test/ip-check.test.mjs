import assert from "node:assert/strict";
import test from "node:test";
import { checkIp } from "../src/lib/db/client.server.ts";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env.PROXYCHECK_TIMEOUT_MS;
const originalApiKey = process.env.PROXYCHECK_API_KEY;

test("checkIp aborts a hanging ProxyCheck request", async () => {
  process.env.PROXYCHECK_TIMEOUT_MS = "1000";
  globalThis.fetch = async (_url, { signal } = {}) =>
    await new Promise((_, reject) => {
      const keepAlive = setTimeout(() => {}, 1_500);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        },
        { once: true },
      );
    });

  const started = Date.now();
  const result = await checkIp("203.0.113.50");
  const elapsed = Date.now() - started;

  assert.equal(result.status, "unavailable");
  assert.ok(elapsed >= 900 && elapsed < 3_000, `aborted after ${elapsed}ms`);
});

test("checkIp keeps a ProxyCheck 429 closed by default", async () => {
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  const result = await checkIp("203.0.113.51");
  assert.equal(result.status, "unavailable");
  assert.equal(result.flagged, false);
});

test("checkIp opens a ProxyCheck outage as a flagged clear result when configured", async () => {
  globalThis.fetch = async () => {
    throw new Error("provider unavailable");
  };
  const result = await checkIp("203.0.113.52", "open_flag");
  assert.equal(result.status, "clear");
  assert.equal(result.flagged, true);
  assert.equal(result.reason, "Network check unavailable");
});

test("checkIp logs a clear warning when the ProxyCheck key is missing", async () => {
  delete process.env.PROXYCHECK_API_KEY;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
    await checkIp("203.0.113.53");
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((line) => line.includes("PROXYCHECK_API_KEY is missing")));
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) delete process.env.PROXYCHECK_TIMEOUT_MS;
  else process.env.PROXYCHECK_TIMEOUT_MS = originalTimeout;
  if (originalApiKey === undefined) delete process.env.PROXYCHECK_API_KEY;
  else process.env.PROXYCHECK_API_KEY = originalApiKey;
});
