ALTER TABLE "verify_tokens" ADD COLUMN IF NOT EXISTS "policy" jsonb;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.verification_state') IS NOT NULL THEN
    ALTER TABLE "verification_state" ADD COLUMN IF NOT EXISTS "policy" jsonb;
  END IF;
END $$;
