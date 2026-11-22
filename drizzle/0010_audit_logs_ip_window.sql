CREATE INDEX IF NOT EXISTS "audit_logs_guild_ip_created_idx"
  ON "audit_logs" ("guild_id", "ip_address", "created_at");
