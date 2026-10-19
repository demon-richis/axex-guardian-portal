# Task 2 Report — Cloudflare Turnstile Verification

## Scope and branch

Task 2 was completed in `demon-richis/axex-guardian-portal` on the `prod-hardening` branch only. No changes were made to `main`, no force-push or PR was created, and no secrets were printed or committed. The Discord bot repository was not changed for Task 2.

The implementation preserves the existing verification rules and portal card styling. Arithmetic quiz prompts/options and answer-based decisions have been removed; embeds, emoji IDs, and unrelated portal design were not changed.

## Changes

### Server-side Turnstile verification

- Added `src/lib/turnstile.server.ts` to call Cloudflare Turnstile `siteverify` server-to-server.
- The verification response must contain `success: true`, the expected action, and a `cdata` SHA-256 binding of:
  - verification token;
  - authenticated Discord ID;
  - guild ID; and
  - challenge ID.
- Missing, malformed, forged, or context-mismatched responses fail as `turnstile_invalid` and return HTTP 403.
- Provider/network failures fail closed as `turnstile_unavailable` and return HTTP 503.
- Provider failures and invalid tokens are checked before the atomic challenge claim, so they do not consume an attempt or set a cooldown.
- A local development bypass is available only when `NODE_ENV != production` and no `TURNSTILE_SECRET_KEY` is configured. The bypass value is not accepted in production.

### Challenge and submission flow

- Added migration `drizzle/0005_turnstile_challenge_timing.sql`.
- Added `challenge_issued_at` and `response_time_ms` to `verify_tokens`.
- Challenge issuance now returns a random challenge ID and Turnstile `cdata`; it no longer exposes an arithmetic prompt, options, or answer.
- The callback schema now requires `turnstileToken` instead of an arithmetic answer.
- The submit service computes response time from the persisted server-side issue timestamp. Client `clickMs` and timeout fields are retained only as telemetry and are not used for pass/fail, bot, timeout, cooldown, or lock decisions.
- The existing atomic claim/update structure remains in place for attempt, cooldown, lock, callback, and outbox behavior.
- The honeypot remains as a weak bot signal. VPN detection remains an immediate quarantine signal, and the existing three-attempt, three-minute/three-hour cooldown, and third-failure lock rules remain unchanged.

### Portal UI and configuration

- Replaced the arithmetic quiz inside the existing verification card with the explicit Cloudflare Turnstile widget.
- Turnstile is loaded from Cloudflare with the existing CSP allowance; the current verification card, avatar, stats, typography, and surrounding layout remain intact.
- Added `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to `.env.example`.
- Production startup validation now fails fast when either Turnstile key is missing.

## Task 2 commits

- `8155479` — `feat(security): replace arithmetic proof with Turnstile`
- `20545a1` — `feat(ui): render Turnstile verification widget`
- `316bfed` — `test(security): cover Turnstile verification paths`
- This report is committed separately after the implementation commits.

## Tests and validation

Final validation on `prod-hardening`:

- `npm test`: **31 passed, 0 failed**.
- `npm run check`: **passed** — ESLint and TypeScript.
- `npm run build`: **passed** — client and SSR production bundles.

Coverage includes:

- Turnstile response binding to token, Discord ID, guild, and challenge ID.
- Missing and invalid Turnstile responses with no consumed attempt.
- Provider outage with no consumed attempt.
- Client `clickMs` unable to fake timing decisions.
- Challenge issuance and server-issued timing persistence.
- Three-attempt cooldown/lock behavior under the Turnstile flow.
- Existing concurrent claim, callback, outbox, identity, VPN, and durable-state regressions.

## Manual Cloudflare and Vercel steps

1. In Cloudflare Turnstile, create a widget for the deployed portal hostnames. Add both the production hostname and the Vercel Preview hostname(s) that will be used for validation. Select the widget mode appropriate for the deployment and copy the public site key and secret key.
2. In Vercel, set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` for the relevant Preview and Production environments. Set `SESSION_SECRET` as required by Part 1. Keep the Turnstile secret server-side; never place it in client code or source control.
3. Apply the additive Drizzle migration through the normal deployment migration process before serving the new application build. The migration only adds nullable columns and does not drop, rewrite, or destructively alter data.
4. Deploy `prod-hardening` to a Vercel Preview environment first. Confirm the verification page renders Turnstile, the browser callback includes a Turnstile token, and the server logs/response behavior do not expose the secret.
5. Test the fail-closed paths in Preview: an invalid token must be rejected without increasing attempts, and a simulated/provider-unavailable response must return a clear unavailable error without increasing attempts. Do not test the local bypass in Production.
6. Verify the Cloudflare widget hostname configuration, Discord OAuth redirect URI, HTTPS serving, and Vercel environment-variable scope before promoting through the normal review/deployment process. Do not merge or push directly to `main` as part of this work.

Task 2 is complete. Waiting for Task 3.
