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
  | {
      success: false;
      reason:
        | "invalid_token"
        | "expired_token"
        | "already_used"
        | "identity_mismatch"
        | "verification_locked"
        | "verification_inactive";
    };

function bindingFailure(
  row: {
    userId: string;
    discordId: string | null;
    expiresAt: Date;
    used: boolean;
    status: string;
  } | undefined,
  identityId: string,
  now: Date,
): IdentityBindingResult | null {
  if (!row) return { success: false, reason: "invalid_token" };
  if (row.used || row.status === "completed" || row.status === "bot_update_pending") {
    return { success: false, reason: "already_used" };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { success: false, reason: "expired_token" };
  }
  if (row.status === "locked") {
    return { success: false, reason: "verification_locked" };
  }
  if (identityId !== row.userId || (row.discordId && row.discordId !== identityId)) {
    return { success: false, reason: "identity_mismatch" };
  }
  if (!["pending", "failed"].includes(row.status)) {
    return { success: false, reason: "verification_inactive" };
  }
  return null;
}

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
  const initialFailure = bindingFailure(row, identity.id, now);
  if (initialFailure) return initialFailure;

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

  if (updated.length) return { success: true };

  const latest = (
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

  return (
    bindingFailure(latest, identity.id, now) ?? {
      success: false,
      reason: "verification_inactive",
    }
  );
}
