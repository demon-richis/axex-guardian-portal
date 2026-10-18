ALTER TABLE "verify_tokens" ADD COLUMN "challenge_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "response_time_ms" integer;
