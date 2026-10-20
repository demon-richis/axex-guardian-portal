# Task 1 Report — Durable Verification Attempts and Cooldowns

## Scope

Implemented Task 1 on the `prod-hardening` branches only. No changes were made to `main`, and nothing was pushed. No secrets were read, printed, or committed. No destructive database operation was added.

Repositories:

- `demon-richis/axex-guardian-portal`
- `demon-richis/axex`

## Changes

### Portal

- Added migration `drizzle/0004_durable_verification_state.sql`.
  - Creates `verification_state` keyed by `(guild_id, user_id)`.
  - Stores `attempts`, `cooldown_until`, `locked_at`, `last_reference_id`, and `updated_at`.
  - Backfills state from existing `verify_tokens` rows without changing existing token/reference values.
- Added the Drizzle model and shared helpers in `src/lib/verification-state.server.ts`.
- Updated `/api/bot/token` to reject issuance while durable state is cooling down or locked, initialize state for new users, and preserve the latest reference.
- Updated `/api/verify/pending` to read durable state even when the previous token has expired. Expired token rows can no longer hide a three-hour cooldown or lockout.
- Updated `/api/challenge` service logic and `/api/verify/$token` status responses to read durable attempts, cooldown, and lock state.
- Updated the submission service so the challenge-consumption SQL statement atomically advances `verification_state` and consumes the challenge. The callback outbox remains in the same SQL statement for terminal outcomes.
- Preserved the existing rules: first failure has a three-minute cooldown, second failure has a three-hour cooldown, third failure locks and quarantines, and VPN detection is terminal immediately. VPN failures now also persist a durable lock until release.
- Added authenticated `POST /api/bot/release`, registered in the TanStack route tree. It resets durable attempts, cooldown, lock, and last reference only after API-key authentication.

### Bot

- Updated `/quarantine release` to call the authenticated portal release endpoint before completing the local quarantine release flow.
- Existing embeds, emoji IDs, and portal design were not changed.

## Tests and validation

Portal:

- `npm test`: **22 passed, 0 failed** (21 existing tests plus the new durable-state regression).
- `npm run check`: **passed** (ESLint and TypeScript).
- `npm run build`: **passed**.
- New regression coverage verifies:
  - failure 1 leaves a new token in cooldown;
  - after more than ten minutes, failure 2 still leaves a new token in the three-hour cooldown;
  - failure 3 locks across another new token;
  - release resets the state and permits a new challenge.

Bot:

- `npm test`: **53 passed, 0 failed**.
- `npm run check`: **passed**.

Both working trees were clean after commit creation and remain on `prod-hardening` ahead of `origin/main`; no remote push was performed.

## Commits

Portal (`demon-richis/axex-guardian-portal`):

- `32d8348` — `feat(portal): add durable verification state`
- `015ac01` — `fix(portal): enforce verification state across tokens`

Bot (`demon-richis/axex`):

- `afbe28c` — `feat(bot): release portal verification state with quarantine`

## Manual production steps

1. Review the two portal commits and the bot commit on their respective `prod-hardening` branches.
2. Apply the portal Drizzle migration `0004_durable_verification_state.sql` to an isolated staging database first. The migration is additive and performs a read-only backfill into the new table; do not skip the migration.
3. Confirm the portal and bot have the existing API-key configuration in their server-only environment variables. Do not place keys in source, logs, or chat.
4. Deploy the portal branch and verify that `POST /api/bot/release` is reachable only with the existing authenticated API-key mechanism.
5. Deploy the bot branch with `WEBSITE_URL` and `WEBSITE_API_KEY` configured, then exercise the complete flow in an isolated staging guild:
   - failure 1 and an immediate fresh token;
   - failure 2 after its three-minute cooldown and a fresh token more than ten minutes after the original token;
   - failure 3 and a fresh-token lockout;
   - administrator quarantine release followed by a fresh verification.
6. Confirm a VPN result is immediately quarantined and remains blocked until the authenticated release action.
7. After staging validation, promote the same commits and migration through the normal production change process. Do not merge or push directly to `main` as part of this task.

Task 1 is complete. Waiting for Task 2.
