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
	COALESCE(maxed."attempts", 0),
	maxed."cooldown_until",
	CASE WHEN maxed."locked" THEN COALESCE(latest."created_at", now()) ELSE NULL END,
	latest."reference_id",
	now()
FROM (
	SELECT DISTINCT ON ("guild_id", "user_id")
		"guild_id", "user_id", "reference_id", "created_at"
	FROM "verify_tokens"
	ORDER BY "guild_id", "user_id", "created_at" DESC NULLS LAST
) latest
JOIN (
	SELECT
		"guild_id",
		"user_id",
		max("attempts") AS "attempts",
		max("cooldown_until") AS "cooldown_until",
		bool_or("status" = 'locked' OR "attempts" >= 3) AS "locked"
	FROM "verify_tokens"
	GROUP BY "guild_id", "user_id"
) maxed USING ("guild_id", "user_id")
ON CONFLICT ("guild_id", "user_id") DO NOTHING;
--> statement-breakpoint
CREATE INDEX "verification_state_cooldown_idx" ON "verification_state" USING btree ("cooldown_until");