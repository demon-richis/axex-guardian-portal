import assert from "node:assert/strict";
import test from "node:test";
import { createOrbitSession, orbitPublicOrigin, verifyOrbitProof } from "../src/lib/orbit.server.ts";
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

test("Orbit uses the private API origin server-side and the public origin for its iframe", async () => {
  const originalApiUrl = process.env["ORBIT_API_URL"];
  const originalPublicUrl = process.env["ORBIT_PUBLIC_URL"];
  const originalSigningSecret = process.env["ORBIT_SIGNING_SECRET"];
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env["ORBIT_API_URL"] = "https://orbit-api.example";
  process.env["ORBIT_PUBLIC_URL"] = "https://orbit.example";
  process.env["ORBIT_SIGNING_SECRET"] = "server-secret";
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json(calls.length === 1 ? { session: "one-time-session" } : { success: true });
  };
  try {
    assert.equal(await createOrbitSession("user-1", "guild-1"), "one-time-session");
    assert.equal(orbitPublicOrigin(), "https://orbit.example");
    assert.equal(await verifyOrbitProof("proof-token", "user-1", "guild-1"), true);
    assert.deepEqual(
      calls.map(({ input }) => input),
      ["https://orbit-api.example/v1/session", "https://orbit-api.example/v1/siteverify"],
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
    if (originalApiUrl === undefined) delete process.env["ORBIT_API_URL"];
    else process.env["ORBIT_API_URL"] = originalApiUrl;
    if (originalPublicUrl === undefined) delete process.env["ORBIT_PUBLIC_URL"];
    else process.env["ORBIT_PUBLIC_URL"] = originalPublicUrl;
    if (originalSigningSecret === undefined) delete process.env["ORBIT_SIGNING_SECRET"];
    else process.env["ORBIT_SIGNING_SECRET"] = originalSigningSecret;
  }
});
