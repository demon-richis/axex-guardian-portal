import assert from "node:assert/strict";
import test from "node:test";
import { classifyVerificationLevel } from "../src/lib/verification-level.server.ts";
import { policyForVerificationLevel } from "../src/lib/verification-policy.server.ts";

const base = {
  initialLevel: "low",
  accountAgeDays: 30,
  newAccountDays: 7,
  riskSignals: {},
  vpnDetected: false,
};

test("hard risk signals always classify as critical", () => {
  for (const signal of [
    { honeypotTriggered: true },
    { riskSignals: { confirmedAltOfBanned: true } },
    { riskSignals: { knownBadIp: true } },
    { riskSignals: { blocklistHit: true } },
  ]) {
    assert.equal(classifyVerificationLevel({ ...base, ...signal }), "critical");
  }
});

test("high and medium conditions follow the portal level thresholds", () => {
  assert.equal(
    classifyVerificationLevel({
      ...base,
      accountAgeDays: 0,
      riskSignals: { defaultAvatar: true },
    }),
    "high",
  );
  assert.equal(classifyVerificationLevel({ ...base, accountAgeDays: 3 }), "medium");
  assert.equal(classifyVerificationLevel({ ...base, vpnDetected: true }), "medium");
  assert.equal(
    classifyVerificationLevel({ ...base, vpnDetected: true, accountAgeDays: 2 }),
    "high",
  );
  assert.equal(classifyVerificationLevel({ ...base, riskSignals: { raidBurst: true } }), "high");
});

test("auto requires policy, candidate, positive signal, adult account age and no red flags", () => {
  const eligible = {
    ...base,
    accountAgeDays: 2,
    allowAuto: true,
    autoCandidate: true,
    profileSignals: { avatarDecoration: true },
  };
  assert.equal(classifyVerificationLevel(eligible), "auto");
  assert.equal(classifyVerificationLevel({ ...eligible, allowAuto: false }), "medium");
  assert.equal(classifyVerificationLevel({ ...eligible, profileSignals: {} }), "medium");
  assert.equal(classifyVerificationLevel({ ...eligible, accountAgeDays: 0 }), "medium");
  assert.equal(
    classifyVerificationLevel({ ...eligible, riskSignals: { flaggedUserAlt: true } }),
    "high",
  );
  assert.equal(classifyVerificationLevel({ ...eligible, vpnDetected: true }), "high");
  assert.equal(
    classifyVerificationLevel({ ...eligible, intelligenceRecommendation: "challenge" }),
    "medium",
  );
});

test("medium level reduces attempts and doubles cooldowns with safe bounds", () => {
  const normal = policyForVerificationLevel(
    { maxAttempts: 3, cooldownsSeconds: [180, 10_800] },
    "low",
  );
  assert.equal(normal.maxAttempts, 3);
  assert.deepEqual(normal.cooldownsSeconds, [180, 10_800]);

  const medium = policyForVerificationLevel(
    { maxAttempts: 3, cooldownsSeconds: [180, 10_800] },
    "medium",
  );
  assert.equal(medium.maxAttempts, 2);
  assert.deepEqual(medium.cooldownsSeconds, [360, 21_600]);

  const bounded = policyForVerificationLevel(
    { maxAttempts: 1, cooldownsSeconds: [86_400, 604_800] },
    "medium",
  );
  assert.equal(bounded.maxAttempts, 1);
  assert.deepEqual(bounded.cooldownsSeconds, [172_800, 604_800]);
});
