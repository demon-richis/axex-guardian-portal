import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { verifyTokens } from "./db/schema.ts";

type PortalDb = ReturnType<typeof getDb>;

type DiscordIdentity = {
  id: string;
  username: string;
  globalName?: string | null | undefined;
  avatar: string | null;
};

type IdentityBindingResult =
  | { success: true }
  | { success: false; reason: "invalid_token" | "expired_or_used" | "identity_mismatch" };

export async function bindOAuthIdentity(
  db: PortalDb,
  token: string,
  identity: DiscordIdentity,
  now = new Date(),
): Promise<IdentityBindingResult> {
  if (!/^\d{17,20}$/.test(identity.id)) {
    return { success: false, reason: "identity_mismatch" };
  }

  const row = (
    await db
      .select({
        userId: verifyTokens.userId,
        discordId: verifyTokens.discordId,
        expiresAt: verifyTokens.expiresAt,
        used: verifyTokens.used,
        status: verifyTokens.status,
      })
      .from(verifyTokens)
      .where(eq(verifyTokens.token, token))
      .limit(1)
  )[0];
  if (!row) return { success: false, reason: "invalid_token" };
  if (
    row.used ||
    row.expiresAt.getTime() <= now.getTime() ||
    !["pending", "failed"].includes(row.status)
  ) {
    return { success: false, reason: "expired_or_used" };
  }
  if (identity.id !== row.userId || (row.discordId && row.discordId !== identity.id)) {
    return { success: false, reason: "identity_mismatch" };
  }

  const updated = await db
    .update(verifyTokens)
    .set({
      discordId: identity.id,
      discordUsername: identity.username,
      discordTag: identity.globalName ?? identity.username,
      discordAvatar: identity.avatar,
    })
    .where(
      and(
        eq(verifyTokens.token, token),
        eq(verifyTokens.userId, identity.id),
        eq(verifyTokens.used, false),
        gt(verifyTokens.expiresAt, now),
        inArray(verifyTokens.status, ["pending", "failed"]),
        or(isNull(verifyTokens.discordId), eq(verifyTokens.discordId, identity.id)),
      ),
    )
    .returning({ token: verifyTokens.token });

  return updated.length ? { success: true } : { success: false, reason: "expired_or_used" };
}
