import assert from "node:assert/strict";
import test from "node:test";
import { publicVerificationSummary } from "../src/lib/verification-response.server.ts";

const row = {
  userId: "bot-issued-user-id",
  guildName: "Guild",
  guildMemberCount: 42,
  expiresAt: new Date("2026-10-20T00:00:00.000Z"),
  status: "pending",
  referenceId: "AX-12345678",
  failureReason: null,
  botAcknowledgedAt: null,
  used: false,
  discordId: "bot-issued-user-id",
  discordUsername: "private-username",
  discordAvatar: "private-avatar",
};

test("public token status omits identity unless the signed OAuth session matches", () => {
  const publicResult = publicVerificationSummary(row, 1, false, () => new Date());
  assert.equal("userId" in publicResult, false);
  assert.equal(publicResult.discordUser, null);
  assert.equal(JSON.stringify(publicResult).includes(row.discordId), false);
  assert.equal(JSON.stringify(publicResult).includes(row.discordUsername), false);

  const sessionResult = publicVerificationSummary(row, 1, true, () => new Date(0));
  assert.equal(sessionResult.userId, row.userId);
  assert.equal(sessionResult.discordUser.id, row.discordId);
  assert.equal(sessionResult.discordUser.username, row.discordUsername);
});
