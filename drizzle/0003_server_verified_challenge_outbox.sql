DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "verify_tokens"
		WHERE "reference_id" IS NOT NULL
		GROUP BY "reference_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'AxeX reference collision: resolve duplicate reference_id values before applying migration 0003; existing values were not modified';
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "bot_callback_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" text NOT NULL,
	"token" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_id" text,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_id" text;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_answer_hash" text;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_prompt" text;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_options" jsonb;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_claim_id" text;--> statement-breakpoint
ALTER TABLE "verify_tokens" ADD COLUMN "challenge_submission_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_callback_outbox_reference_id_unique_idx" ON "bot_callback_outbox" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "bot_callback_outbox_due_idx" ON "bot_callback_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verify_tokens_reference_id_unique_idx" ON "verify_tokens" USING btree ("reference_id") WHERE "verify_tokens"."reference_id" is not null;
