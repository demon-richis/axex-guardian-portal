# Part 1 Report — Tasks 1–3

## Scope and branch

All work is on `prod-hardening` in `demon-richis/axex-guardian-portal`. No changes were made to `main`, no force-push was used, and no secrets were printed or committed.

Task 2 was not specified in the instructions available for this work session, so no Task 2 implementation is claimed here. Task 1 was completed previously and is summarized below; Task 3 is implemented in this continuation.

## Task 1 — Durable verification attempts and cooldowns

The portal now has durable `verification_state` keyed by `(guild_id, user_id)`, backfilled from existing token rows. Challenge consumption advances attempts, cooldown, lock, and reference state atomically with challenge consumption and terminal callback enqueue. Token issuance, pending lookup, challenge issuance, token status, and submission all use durable state. The authenticated bot release endpoint resets state, and the bot quarantine-release command calls it. The existing three-attempt, three-minute/three-hour cooldown, third-failure lock, and VPN quarantine rules remain unchanged.

Task 1 portal commits:

- `32d8348` — `feat(portal): add durable verification state`
- `015ac01` — `fix(portal): enforce verification state across tokens`
- `2fb920b` — `docs: add Task 1 hardening report`

The bot-side Task 1 commit is in `demon-richis/axex`:

- `afbe28c` — `feat(bot): release portal verification state with quarantine`

## Task 3 — Security headers and session binding

### Security headers and cache policy

Added global request middleware that applies the following headers to page and API responses:

- Content-Security-Policy with same-origin defaults, Cloudflare Turnstile support, Discord/Discord CDN support, `frame-ancestors 'none'`, `object-src 'none'`, and restrictive connection/image/frame sources.
- Strict-Transport-Security with one-year max age and subdomains.
- X-Content-Type-Options: `nosniff`.
- Referrer-Policy: `no-referrer`.
- Permissions-Policy disabling camera, microphone, geolocation, and payment access.
- Cross-Origin-Opener-Policy: `same-origin`.

All `/api/` responses receive `Cache-Control: no-store`, preventing token- and user-related responses from being cached.

### OAuth state and session binding

OAuth no longer uses the verification token as the OAuth `state` value. `/api/auth/discord` creates a cryptographically random nonce and stores a short-lived signed state payload in an `HttpOnly; Secure; SameSite=Lax` cookie. The OAuth query contains only the nonce. `/api/auth/callback` verifies the signature, nonce, and expiry, recovers the token from the cookie, and rejects missing, mismatched, tampered, or expired state.

After successful Discord identity binding, the callback issues a signed `HttpOnly; Secure; SameSite=Lax` session cookie containing the verification token, Discord ID, and short expiry. Both `/api/challenge` and `/api/callback` require this session. Callback requests must also present a Discord ID matching the session binding.

Added `SESSION_SECRET` to `.env.example` and startup validation that fails fast in production unless it contains at least 32 characters.

Task 3 commits:

- `9496d03` — `fix(security): bind OAuth and verification sessions`
- `99cd6af` — `test(security): cover session binding and headers`

## Tests and validation

Final portal validation is green:

- `npm test`: **26 passed, 0 failed**.
- `npm run check`: **passed** — ESLint and TypeScript.
- `npm run build`: **passed** — client and SSR production bundles.

The new security tests cover missing, mismatched, and expired OAuth state; missing and mismatched session cookies; page and API security headers; API `no-store`; and production `SESSION_SECRET` validation. The existing Task 1 regression coverage remains green.

## Manual production steps

1. Generate a high-entropy `SESSION_SECRET` of at least 32 characters and set it in Vercel for the relevant Production and Preview environments. Use the same value for all instances of a given environment so signed cookies validate across serverless invocations. Do not commit or paste the value into source control.
2. Keep the existing portal environment variables configured: `DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `AXEX_BOT_API_KEY`, `BOT_WEBHOOK_URL`, `PROXYCHECK_API_KEY`, `INTELLIGENCE_URL`, and `INTELLIGENCE_API_KEY`, as applicable to the deployment. `SESSION_SECRET` is now required in Production.
3. Confirm the Discord application OAuth redirect URI exactly matches the deployed portal callback URL, for example `https://<portal-domain>/api/auth/callback`. Test the OAuth flow over HTTPS because the state and session cookies are Secure.
4. If Cloudflare Turnstile is enabled or added to the verification UI, configure the Turnstile site key and server-side secret through the existing deployment secret-management process. The CSP already permits `https://challenges.cloudflare.com`; do not put a Turnstile secret in client code. No new Turnstile secret variable was introduced by this task because the current portal does not have a Turnstile integration to wire.
5. In Vercel, deploy the `prod-hardening` branch to a Preview environment first. Verify that page responses contain the security headers, API responses contain `Cache-Control: no-store`, OAuth redirects set the signed state cookie, the callback rejects a missing or altered state, and challenge/callback reject missing or mismatched sessions.
6. Verify that the deployment is served through HTTPS, that no conflicting Vercel or CDN header configuration overwrites the middleware headers, and that the production domain is not embedded by an iframe.
7. After staging verification, promote the same commits through the normal review/deployment process. Do not merge or push directly to `main` as part of this task.

Part 1 is complete. Waiting for Part 2.
