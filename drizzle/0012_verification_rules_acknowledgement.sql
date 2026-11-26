ALTER TABLE verify_tokens
  ADD COLUMN IF NOT EXISTS rules_acknowledged_at TIMESTAMPTZ;
