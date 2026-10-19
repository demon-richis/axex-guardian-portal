# Part 1 Report — Tasks 1–3

## Scope and branch

Tasks 1–3 are implemented on `prod-hardening` in `demon-richis/axex-guardian-portal`. No changes were made to `main`, no force-push or PR was created, and no secrets were printed or committed. The Discord bot repository was changed only for the Task 1 quarantine-release integration; it was not changed for Tasks 2–3.

The existing verification rules remain unchanged: three attempts; a three-minute cooldown after failure one; a three-hour cooldown after failure two; lock and quarantine after failure three; and immediate quarantine for VPN/proxy detection. Existing embeds, emoji IDs, and portal design were preserved.

## Task 1 — Durable verification attempts and cooldowns

Added durable `verification_state`, keyed by `(guild_id, user_id)`, with attempts, cooldown, lock, last reference, and update timestamps. Existing token rows are backfilled by migration. Token issuance, pending lookup, challenge issuance, token status, submission, and authenticated quarantine release now use this durable state rather than token-local counters.

Challenge consumption advances attempts, cooldown, lock, and reference state atomically with the challenge claim and terminal callback enqueue. State resets only after successful verification or an authenticated bot release. The bot quarantine-release command calls the portal release endpoint.

The follow-up hardening fixes the success path so a fail-fail-pass sequence commits attempts `0`, clears `cooldown_until`, and clears `locked_at` while retaining `last_reference_id`. The claim state update is now conditional on the same live token/challenge predicate as the token update, so an expired or concurrently consumed challenge cannot increment durable state without consuming the challenge. Migration `0004_durable_verification_state.sql` backfills only from each user's latest token: completed/verified latest rows reset state; locked latest rows create a lock; and pending/failed latest rows carry attempts with only still-future cooldowns. Bot quarantine releases also write an `audit_logs` row with event `STATE_RELEASED` and no secret-bearing metadata.

To count rows that the corrected backfill would treat as locked on staging, run:

```sql
WITH latest AS (
  SELECT DISTINCT ON (guild_id, user_id)
    guild_id, user_id, status, attempts
  FROM verify_tokens
  ORDER BY guild_id, user_id, created_at DESC NULLS LAST, token DESC
)
SELECT count(*) AS rows_locked_by_backfill
FROM latest
WHERE status = 'locked'
   OR (status NOT IN ('completed', 'verified') AND attempts >= 3);
```

Portal commits:

- `32d8348` — `feat(portal): add durable verification state`
- `015ac01` — `fix(portal): enforce verification state across tokens`
- `2fb920b` — `docs: add Task 1 hardening report`
- `741fdc9` — `fix(security): harden verification state transitions`
- `72026b2` — `test(security): cover verification state edge cases`

Bot commit in `demon-richis/axex`:

- `afbe28c` — `feat(bot): release portal verification state with quarantine`

## Task 2 — Cloudflare Turnstile and server-side timing

Replaced the arithmetic quiz with Cloudflare Turnstile while keeping the existing verification card and surrounding portal design. The server calls Turnstile `siteverify` and requires a successful response bound through `cdata` to the verification token, authenticated Discord ID, guild ID, and challenge ID.

Added migration `0005_turnstile_challenge_timing.sql` with nullable `challenge_issued_at` and `response_time_ms` columns. The submit service computes response time from the persisted server issue timestamp. Client `clickMs` and timeout values remain telemetry only and cannot influence pass/fail, bot, cooldown, or lock decisions. Invalid tokens return a clear rejection without consuming an attempt. Provider/network failures fail closed with an unavailable response and do not consume an attempt. The existing atomic claim structure and VPN/honeypot rules remain in place.

Production requires `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. A local development bypass is accepted only when `NODE_ENV != production` and no Turnstile secret is configured; it is not accepted in production.

Task 2 commits:

- `8155479` — `feat(security): replace arithmetic proof with Turnstile`
- `20545a1` — `feat(ui): render Turnstile verification widget`
- `316bfed` — `test(security): cover Turnstile verification paths`
- `4bd538d` — `docs: add Task 2 Turnstile report`

## Task 3 — Security headers and session binding

### Security headers and cache policy

Added global response middleware applying the following headers to pages and APIs:

- Content-Security-Policy with same-origin defaults, Cloudflare Turnstile support, Discord and Discord CDN support, `frame-ancestors 'none'`, `object-src 'none'`, and restrictive connection/image/frame sources.
- Strict-Transport-Security with one-year max age and subdomains.
- X-Content-Type-Options: `nosniff`.
- Referrer-Policy: `no-referrer`.
- Permissions-Policy disabling camera, microphone, geolocation, and payment access.
- Cross-Origin-Opener-Policy: `same-origin`.

All `/api/` responses receive `Cache-Control: no-store`, preventing token and user data from being cached.

### OAuth state and verification session binding

OAuth no longer uses the verification token as the OAuth `state` value. `/api/auth/discord` creates a cryptographically random nonce and stores a short-lived signed state payload in an `HttpOnly; Secure; SameSite=Lax` cookie. The OAuth query contains only the nonce. `/api/auth/callback` verifies the cookie signature, nonce, and expiry, and rejects missing, mismatched, tampered, or expired state.

After successful Discord identity binding, the callback issues a signed, short-lived `HttpOnly; Secure; SameSite=Lax` session cookie containing the verification token and Discord ID. Both `/api/challenge` and `/api/callback` require that session, and callback requests must present a matching Discord ID.

Added `SESSION_SECRET` to `.env.example` and startup validation that fails fast in production unless it contains at least 32 characters.

Task 3 commits:

- `9496d03` — `fix(security): bind OAuth and verification sessions`
- `99cd6af` — `test(security): cover session binding and headers`
- `3faece6` — `docs: add Part 1 security report` (superseded by this corrected report)

## Tests and validation

The current portal validation is green:

- `npm test`: **34 passed, 0 failed**.
- `npm run check`: **passed** — ESLint and TypeScript.
- `npm run build`: **passed** — client and SSR production bundles.

Tests cover durable cross-token cooldown and lock behavior; latest-token-only migration backfill; fail-fail-pass reset and new-token issuance; expired-challenge claim races; authenticated release reset; Turnstile context binding; missing and invalid Turnstile tokens; provider outage with no consumed attempt; client timing anti-spoofing; concurrent claims; OAuth state rejection; missing and mismatched session cookies; page and API security headers; API `no-store`; and production secret validation.

## Manual production steps

1. Create a Cloudflare Turnstile widget for the deployed portal hostnames. Include the production hostname and the Vercel Preview hostname(s) used for staging. Record the public site key and secret key.
2. In Vercel, set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` for the relevant Preview and Production environments. Set a high-entropy `SESSION_SECRET` of at least 32 characters in each environment. Use the same value across instances of a given environment so signed cookies validate consistently. Do not commit or paste secret values into source control.
3. Keep the existing portal variables configured as applicable: `DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `AXEX_BOT_API_KEY`, `BOT_WEBHOOK_URL`, `PROXYCHECK_API_KEY`, `INTELLIGENCE_URL`, and `INTELLIGENCE_API_KEY`.
4. Apply the additive Drizzle migrations through the normal deployment migration process before serving the new build. The Task 1 and Task 2 migrations do not drop data or perform destructive database operations.
5. Deploy `prod-hardening` to a Vercel Preview environment first. Confirm that page and API responses contain the security headers, API responses contain `Cache-Control: no-store`, the OAuth redirect sets the signed state cookie, missing or altered state is rejected, and challenge/callback requests without the matching session are rejected.
6. Exercise Turnstile in Preview with a valid widget response. Also verify that invalid tokens do not increment attempts and that a provider/network failure returns a clear unavailable response without incrementing attempts. Do not use the local bypass in Production.
7. Confirm the Discord OAuth redirect URI exactly matches the deployed callback URL, for example `https://<portal-domain>/api/auth/callback`. Test OAuth over HTTPS because the state and session cookies are Secure. Verify that Vercel or an upstream CDN does not overwrite the application security headers.
8. After Preview validation, promote through the normal review and deployment process. Do not merge or push directly to `main` as part of this work.

Part 1 is complete. Waiting for Part 2.
