CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text,
	"discord_tag" text,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"ip_address" text,
	"vpn_detected" boolean DEFAULT false NOT NULL,
	"account_age_days" integer,
	"click_ms" integer,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guild_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"guild_name" text NOT NULL,
	"guild_icon" text,
	"member_count" integer DEFAULT 0,
	"webhook_url" text NOT NULL,
	"log_channel_id" text,
	"verified_role_id" text,
	"quarantine_role_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "suspicious_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"discord_tag" text,
	"ip_address" text,
	"vpn_type" text,
	"account_age_days" integer,
	"click_ms" integer,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now(),
	"auto_banned" boolean DEFAULT false NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "verify_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"guild_member_count" integer DEFAULT 0,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"discord_id" text,
	"discord_username" text,
	"discord_tag" text,
	"discord_avatar" text,
	"ip_address" text,
	"vpn_detected" boolean DEFAULT false,
	"vpn_type" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_logs_guild_created_idx" ON "audit_logs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suspicious_attempts_guild_user_idx" ON "suspicious_attempts" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "suspicious_attempts_guild_last_attempt_idx" ON "suspicious_attempts" USING btree ("guild_id","last_attempt_at");