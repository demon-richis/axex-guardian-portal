ALTER TABLE "guild_configs" ALTER COLUMN "webhook_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "cooldown_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "failure_reason" text;