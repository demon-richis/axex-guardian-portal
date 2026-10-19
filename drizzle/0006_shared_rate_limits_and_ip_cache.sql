ALTER TABLE "bot_callback_outbox"
ADD COLUMN "stuck_alerted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "bot_callback_outbox_stuck_idx"
ON "bot_callback_outbox" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"bucket_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY("bucket_hash", "window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_idx"
ON "rate_limit_buckets" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "ip_check_cache" (
	"ip_hash" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"is_vpn" boolean NOT NULL,
	"type" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ip_check_cache_expires_idx"
ON "ip_check_cache" USING btree ("expires_at");
