import assert from "node:assert/strict";
import test from "node:test";
import { loadingViewMode, stageStates } from "../src/lib/loading-stages.ts";

test("first visit checks the link without exposing an authentication checklist", () => {
  assert.equal(loadingViewMode(false), "compact");
  assert.deepEqual(
    stageStates({
      linkValid: false,
      authDone: false,
      networkChecked: false,
      challengeReady: false,
    }),
    ["pending", "pending", "pending"],
  );
  assert.deepEqual(
    stageStates({
      linkValid: true,
      authDone: false,
      networkChecked: false,
      challengeReady: false,
    }),
    ["active", "pending", "pending"],
  );
});

test("OAuth return advances each checklist stage from active to done", () => {
  assert.equal(loadingViewMode(true), "checklist");
  assert.deepEqual(
    stageStates({
      linkValid: true,
      authDone: true,
      networkChecked: false,
      challengeReady: false,
    }),
    ["done", "active", "pending"],
  );
  assert.deepEqual(
    stageStates({
      linkValid: true,
      authDone: true,
      networkChecked: true,
      challengeReady: false,
    }),
    ["done", "done", "active"],
  );
  assert.deepEqual(
    stageStates({
      linkValid: true,
      authDone: true,
      networkChecked: true,
      challengeReady: true,
    }),
    ["done", "done", "done"],
  );
});
