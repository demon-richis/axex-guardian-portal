import assert from "node:assert/strict";
import test from "node:test";
import { checkIp } from "../src/lib/db/client.server.ts";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env.PROXYCHECK_TIMEOUT_MS;

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

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) delete process.env.PROXYCHECK_TIMEOUT_MS;
  else process.env.PROXYCHECK_TIMEOUT_MS = originalTimeout;
});
