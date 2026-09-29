ALTER TABLE "verify_tokens" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "reference_id" text;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "bot_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "bot_error" text;