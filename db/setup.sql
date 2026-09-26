CREATE TABLE IF NOT EXISTS verify_tokens (
  token              TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  guild_id           TEXT NOT NULL,
  guild_name         TEXT NOT NULL,
  guild_member_count INTEGER DEFAULT 0,
  expires_at         TIMESTAMPTZ NOT NULL,
  used               BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now(),
  discord_id         TEXT,
  discord_username   TEXT,
  discord_avatar     TEXT
);

INSERT INTO verify_tokens (token, user_id, guild_id, guild_name, guild_member_count, expires_at, used) VALUES
  ('test-pending-001', '123456789', '987654321', 'Axex Security Hub', 1204, NOW() + interval '1 hour', false),
  ('test-used-002',    '123456789', '987654321', 'Axex Security Hub', 1204, NOW() + interval '1 hour', true)
ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at, used = EXCLUDED.used;
