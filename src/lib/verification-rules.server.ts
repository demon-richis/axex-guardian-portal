import { and, eq, gt, isNull } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { verifyTokens } from "./db/schema.ts";

type PortalDb = ReturnType<typeof getDb>;

export async function acknowledgeVerificationRules(
  db: PortalDb,
  token: string,
  discordId: string,
  now = new Date(),
): Promise<
  | { success: true; acknowledgedAt: Date }
  | { success: false; error: "invalid_token" | "identity_mismatch" | "not_required" }
> {
  const row = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  if (
    !row ||
    row.used ||
    row.expiresAt.getTime() <= now.getTime() ||
    !["pending", "failed"].includes(row.status)
  ) {
    return { success: false, error: "invalid_token" };
  }
  if (!row.discordId || row.discordId !== row.userId || row.discordId !== discordId) {
    return { success: false, error: "identity_mismatch" };
  }
  if (row.level !== "medium") return { success: false, error: "not_required" };
  if (row.rulesAcknowledgedAt) {
    return { success: true, acknowledgedAt: row.rulesAcknowledgedAt };
  }

  const updated = await db
    .update(verifyTokens)
    .set({ rulesAcknowledgedAt: now })
    .where(
      and(
        eq(verifyTokens.token, token),
        eq(verifyTokens.discordId, discordId),
        eq(verifyTokens.level, "medium"),
        eq(verifyTokens.used, false),
        gt(verifyTokens.expiresAt, now),
        isNull(verifyTokens.rulesAcknowledgedAt),
      ),
    )
    .returning({ rulesAcknowledgedAt: verifyTokens.rulesAcknowledgedAt });
  if (updated[0]?.rulesAcknowledgedAt) {
    return { success: true, acknowledgedAt: updated[0].rulesAcknowledgedAt };
  }

  const latest = (
    await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
  )[0];
  return latest?.rulesAcknowledgedAt
    ? { success: true, acknowledgedAt: latest.rulesAcknowledgedAt }
    : { success: false, error: "invalid_token" };
}
