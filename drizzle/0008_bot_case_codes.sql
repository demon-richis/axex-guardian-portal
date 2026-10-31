ALTER TABLE "verify_tokens" ADD COLUMN "case_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "verify_tokens_guild_case_code_unique_idx" ON "verify_tokens" USING btree ("guild_id","case_code") WHERE "verify_tokens"."case_code" is not null;
