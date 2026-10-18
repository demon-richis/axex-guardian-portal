import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const guildConfigs = pgTable("guild_configs", {
  guildId: text("guild_id").primaryKey(),
  guildName: text("guild_name").notNull(),
  guildIcon: text("guild_icon"),
  memberCount: integer("member_count").default(0),
  webhookUrl: text("webhook_url"),
  logChannelId: text("log_channel_id"),
  verifiedRoleId: text("verified_role_id"),
  quarantineRoleId: text("quarantine_role_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const verifyTokens = pgTable(
  "verify_tokens",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull(),
    guildId: text("guild_id").notNull(),
    guildName: text("guild_name").notNull(),
    guildMemberCount: integer("guild_member_count").default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").default(false),
    status: text("status").default("pending").notNull(),
    referenceId: text("reference_id"),
    challengeId: text("challenge_id"),
    challengeAnswerHash: text("challenge_answer_hash"),
    challengePrompt: text("challenge_prompt"),
    challengeOptions: jsonb("challenge_options").$type<string[]>(),
    challengeIssuedAt: timestamp("challenge_issued_at", { withTimezone: true }),
    challengeExpiresAt: timestamp("challenge_expires_at", { withTimezone: true }),
    challengeConsumedAt: timestamp("challenge_consumed_at", { withTimezone: true }),
    challengeClaimId: text("challenge_claim_id"),
    challengeSubmissionHash: text("challenge_submission_hash"),
    responseTimeMs: integer("response_time_ms"),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    failureReason: text("failure_reason"),
    botAcknowledgedAt: timestamp("bot_acknowledged_at", { withTimezone: true }),
    botError: text("bot_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    // Filled by the OAuth callback so the final result can't be forged by the browser
    discordId: text("discord_id"),
    discordUsername: text("discord_username"),
    discordTag: text("discord_tag"),
    discordAvatar: text("discord_avatar"),
    ipAddress: text("ip_address"),
    vpnDetected: boolean("vpn_detected").default(false),
    vpnType: text("vpn_type"),
    attempts: integer("attempts").default(0).notNull(),
    flagged: boolean("flagged").default(false).notNull(),
    flagReason: text("flag_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("verify_tokens_reference_id_unique_idx")
      .on(table.referenceId)
      .where(sql`${table.referenceId} is not null`),
  ],
);

export const verificationState = pgTable(
  "verification_state",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastReferenceId: text("last_reference_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("verification_state_guild_user_unique_idx").on(table.guildId, table.userId),
    index("verification_state_cooldown_idx").on(table.cooldownUntil),
  ],
);

export const botCallbackOutbox = pgTable(
  "bot_callback_outbox",
  {
    id: serial("id").primaryKey(),
    referenceId: text("reference_id").notNull(),
    token: text("token").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    claimId: text("claim_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bot_callback_outbox_reference_id_unique_idx").on(table.referenceId),
    index("bot_callback_outbox_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id"),
    discordTag: text("discord_tag"),
    eventType: text("event_type").notNull(),
    severity: text("severity").$type<"info" | "warn" | "critical">().default("info").notNull(),
    ipAddress: text("ip_address"),
    vpnDetected: boolean("vpn_detected").default(false).notNull(),
    accountAgeDays: integer("account_age_days"),
    clickMs: integer("click_ms"),
    flagged: boolean("flagged").default(false).notNull(),
    flagReason: text("flag_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("audit_logs_guild_created_idx").on(table.guildId, table.createdAt)],
);

export const suspiciousAttempts = pgTable(
  "suspicious_attempts",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    discordTag: text("discord_tag"),
    ipAddress: text("ip_address"),
    vpnType: text("vpn_type"),
    accountAgeDays: integer("account_age_days"),
    clickMs: integer("click_ms"),
    attemptCount: integer("attempt_count").default(1).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).defaultNow(),
    autoBanned: boolean("auto_banned").default(false).notNull(),
    reason: text("reason"),
  },
  (table) => [
    uniqueIndex("suspicious_attempts_guild_user_idx").on(table.guildId, table.userId),
    index("suspicious_attempts_guild_last_attempt_idx").on(table.guildId, table.lastAttemptAt),
  ],
);
