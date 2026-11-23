ALTER TABLE "verify_tokens"
  ADD COLUMN IF NOT EXISTS "initial_level" text DEFAULT 'low' NOT NULL,
  ADD COLUMN IF NOT EXISTS "level" text DEFAULT 'low' NOT NULL,
  ADD COLUMN IF NOT EXISTS "auto_candidate" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "profile_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "risk_signals" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verify_tokens_initial_level_check'
  ) THEN
    ALTER TABLE "verify_tokens"
      ADD CONSTRAINT "verify_tokens_initial_level_check"
      CHECK ("initial_level" IN ('auto', 'low', 'medium', 'high', 'critical'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verify_tokens_level_check'
  ) THEN
    ALTER TABLE "verify_tokens"
      ADD CONSTRAINT "verify_tokens_level_check"
      CHECK ("level" IN ('auto', 'low', 'medium', 'high', 'critical'));
  END IF;
END $$;
