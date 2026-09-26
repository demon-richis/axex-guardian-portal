import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const verifyTokens = pgTable("verify_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  guildName: text("guild_name").notNull(),
  guildMemberCount: integer("guild_member_count").default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // Filled by the OAuth callback so the final result can't be forged by the browser
  discordId: text("discord_id"),
  discordUsername: text("discord_username"),
  discordAvatar: text("discord_avatar"),
});
