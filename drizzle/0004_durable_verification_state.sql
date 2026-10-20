CREATE TABLE "verification_state" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cooldown_until" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"last_reference_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_state_pkey" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
INSERT INTO "verification_state" (
	"guild_id", "user_id", "attempts", "cooldown_until", "locked_at", "last_reference_id", "updated_at"
)
SELECT
	latest."guild_id",
	latest."user_id",
	CASE
		WHEN latest."status" IN ('completed', 'verified') THEN 0
		ELSE COALESCE(latest."attempts", 0)
	END,
	CASE
		WHEN latest."status" IN ('pending', 'failed')
			AND latest."cooldown_until" > now()
		THEN latest."cooldown_until"
		ELSE NULL
	END,
	CASE
		WHEN latest."status" = 'locked'
		THEN COALESCE(latest."completed_at", latest."created_at", now())
		ELSE NULL
	END,
	latest."reference_id",
	now()
FROM (
	SELECT DISTINCT ON ("guild_id", "user_id")
		"guild_id",
		"user_id",
		"status",
		"attempts",
		"cooldown_until",
		"completed_at",
		"created_at",
		"reference_id",
		"token"
	FROM "verify_tokens"
	ORDER BY "guild_id", "user_id", "created_at" DESC NULLS LAST, "token" DESC
) latest
ON CONFLICT ("guild_id", "user_id") DO NOTHING;
--> statement-breakpoint
CREATE INDEX "verification_state_cooldown_idx" ON "verification_state" USING btree ("cooldown_until");
