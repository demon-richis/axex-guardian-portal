import { and, eq } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { verificationState } from "./db/schema.ts";

type PortalDb = ReturnType<typeof getDb>;

export async function ensureVerificationState(
  db: PortalDb,
  guildId: string,
  userId: string,
  now = new Date(),
) {
  await db
    .insert(verificationState)
    .values({ guildId, userId, updatedAt: now })
    .onConflictDoNothing({ target: [verificationState.guildId, verificationState.userId] });
  return (
    (
      await db
        .select()
        .from(verificationState)
        .where(and(eq(verificationState.guildId, guildId), eq(verificationState.userId, userId)))
        .limit(1)
    )[0] ?? null
  );
}

export async function releaseVerificationState(
  db: PortalDb,
  guildId: string,
  userId: string,
  now = new Date(),
) {
  const released = await db
    .insert(verificationState)
    .values({
      guildId,
      userId,
      attempts: 0,
      cooldownUntil: null,
      lockedAt: null,
      lastReferenceId: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [verificationState.guildId, verificationState.userId],
      set: {
        attempts: 0,
        cooldownUntil: null,
        lockedAt: null,
        lastReferenceId: null,
        updatedAt: now,
      },
    })
    .returning({ guildId: verificationState.guildId, userId: verificationState.userId });
  return Boolean(released.length);
}
