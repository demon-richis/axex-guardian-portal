import assert from "node:assert/strict";
import test from "node:test";
import { createOrbitSession, verifyOrbitProof } from "../src/lib/orbit.server.ts";
import { riskSignalsFromIntelligence } from "../src/lib/intelligence-signals.server.ts";

test("intelligence recommendations become explicit critical and escalating signals", () => {
  const signals = riskSignalsFromIntelligence({
    recommendation: "challenge",
    reasons: ["BLOCKLIST_ABUSE"],
    breakdown: {
      network: { reasons: ["BLOCKLIST_ABUSE"], data: { flagged: true } },
      username: { reasons: ["SUSPICIOUS_USERNAME"] },
      alts: { reasons: ["SAME_IP_AS_FLAGGED"] },
    },
  });
  assert.equal(signals.blocklistHit, true);
  assert.equal(signals.knownBadIp, true);
  assert.equal(signals.confirmedAltOfBanned, true);
  assert.equal(signals.flaggedUserAlt, true);
  assert.equal(signals.suspiciousUsername, true);
});

test("Orbit sessions and proof verification keep the site secret server-side", async () => {
  const originalUrl = process.env["ORBIT_BASE_URL"];
  const originalSecret = process.env["ORBIT_SITE_SECRET"];
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env["ORBIT_BASE_URL"] = "https://orbit.example";
  process.env["ORBIT_SITE_SECRET"] = "server-secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json(calls.length === 1 ? { session: "one-time-session" } : { success: true });
  };
  try {
    assert.equal(await createOrbitSession("user-1", "guild-1"), "one-time-session");
    assert.equal(await verifyOrbitProof("proof-token", "user-1", "guild-1"), true);
    assert.deepEqual(
      calls.map(({ input }) => input),
      ["https://orbit.example/v1/session", "https://orbit.example/v1/siteverify"],
    );
    for (const { init } of calls) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer server-secret");
    }
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      userId: "user-1",
      guildId: "guild-1",
      difficulty: "high",
    });
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      token: "proof-token",
      userId: "user-1",
      guildId: "guild-1",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env["ORBIT_BASE_URL"];
    else process.env["ORBIT_BASE_URL"] = originalUrl;
    if (originalSecret === undefined) delete process.env["ORBIT_SITE_SECRET"];
    else process.env["ORBIT_SITE_SECRET"] = originalSecret;
  }
});
