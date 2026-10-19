UPDATE verification_state
SET locked_at = COALESCE(locked_at, updated_at, now()),
    cooldown_until = NULL,
    updated_at = now()
WHERE attempts >= 3
  AND locked_at IS NULL;
