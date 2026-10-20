import type { verifyTokens } from "./db/schema.ts";

type VerificationRow = typeof verifyTokens.$inferSelect;

export function publicVerificationSummary(
  row: VerificationRow,
  attempts: number,
  sessionMatches: boolean,
  snowflakeToDate: (id: string) => Date,
) {
  const discordUser =
    sessionMatches && row.discordId
      ? {
          id: row.discordId,
          username: row.discordUsername,
          avatar: row.discordAvatar,
          createdAt: snowflakeToDate(row.discordId).toISOString(),
        }
      : null;

  return {
    guildName: row.guildName,
    guildMemberCount: row.guildMemberCount ?? 0,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    referenceId: row.referenceId,
    attempts,
    failureReason: row.failureReason,
    botAcknowledged: Boolean(row.botAcknowledgedAt),
    used: row.used,
    discordUser,
    ...(sessionMatches ? { userId: row.userId } : {}),
  };
}
