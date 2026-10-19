# Deployment runbook

This runbook covers the guardian portal repository. The bot and account-intelligence repositories were not present in this workspace; their host variables and migration runners must be documented alongside their deployment artifacts before a coordinated three-service release.

## Vercel portal configuration

Configure these values as server-side Vercel project variables for Preview and Production as appropriate. Never use a `VITE_` prefix for secrets.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon serverless Postgres connection string |
| `SESSION_SECRET` | At least 32 random characters; shared by portal instances in one environment |
| `BOT_TO_PORTAL_KEY` | Authenticates bot requests to portal APIs |
| `PORTAL_TO_BOT_KEY` | Authenticates portal callbacks to the bot |
| `CRON_SECRET` | Bearer secret for the Vercel Cron outbox/retention endpoint |
| `BOT_WEBHOOK_URL` | Bot's verification callback receiver |
| `DISCORD_CLIENT_ID` | Discord OAuth application client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth application client secret |
| `DISCORD_REDIRECT_URI` | `https://<portal-host>/api/auth/callback` |
| `TURNSTILE_SITE_KEY` | Public Turnstile widget key |
| `TURNSTILE_SECRET_KEY` | Server-only Turnstile verification key |
| `PROXYCHECK_API_KEY` | Optional server-side network-risk lookup key |
| `INTELLIGENCE_URL` | Account-intelligence service base URL |
| `INTELLIGENCE_API_KEY` | Portal-to-intelligence service key |
| `TRUSTED_PROXY_MODE` | Set to `vercel`; the portal prefers Vercel's `x-vercel-forwarded-for` and falls back to `x-real-ip`, ignoring generic `x-forwarded-for` |
| `TOKEN_RETENTION_DAYS` | Optional; defaults to 30 days |
| `AUDIT_LOG_RETENTION_DAYS` | Optional; defaults to 365 days |
| `PORTAL_HOSTNAME` | Optional expected Turnstile hostname; defaults to the request hostname |

`AXEX_BOT_API_KEY` remains a deprecated one-release fallback for both API directions. Set the two directional keys before removing the legacy key. The development-only memory rate limiter is not allowed in production.

On Vercel, terminal bot callbacks are scheduled with `waitUntil` so the verification response does not wait for the bot's webhook. Other runtimes await the short immediate attempt; the durable outbox and Cron worker remain the retry path in either case.

## Discord and Turnstile

1. Register `https://<portal-host>/api/auth/callback` as an allowed Discord OAuth redirect URI and set the same exact URL in `DISCORD_REDIRECT_URI`.
2. Create a Cloudflare Turnstile managed widget for the portal host. Configure the widget to use action `axex_verify`; portal responses are additionally bound to the verification token, Discord ID, guild ID, and issued challenge ID.
3. Set the site key and secret in the correct Vercel environments. Keep the secret server-only.
4. Set `TRUSTED_PROXY_MODE=vercel`. Do not enable Cloudflare mode unless every request is guaranteed to traverse the configured Cloudflare edge.

## Migrations and cron

1. Back up the Neon database and review the additive SQL migrations in order.
2. Apply pending Drizzle journal migrations before deploying code that uses them:

   ```sh
   npm run db:migrate
   ```

   Migrations `0006` and `0007` add shared limiter/cache storage and conservatively lock legacy state with three attempts. They do not remove verification state or audit history.
3. Deploy the portal only after migration succeeds. Keep verification-state lock rows until the bot calls the authenticated release endpoint.
4. The Vercel Cron schedule calls `GET /api/bot/outbox` daily at 03:00 UTC. Configure `CRON_SECRET`; the endpoint requires it as an `Authorization: Bearer ...` value. Vercel Hobby plans support daily Cron schedules only.
5. The long-running bot should separately poll `POST /api/bot/outbox` every 20–30 seconds with `x-api-key`. That bot loop is required for timely draining on Hobby plans and must be implemented/deployed from the bot repository.

## Key rotation

1. Generate separate high-entropy bot-to-portal and portal-to-bot keys.
2. Configure `BOT_TO_PORTAL_KEY` on the portal and the matching bot secret; configure `PORTAL_TO_BOT_KEY` on the portal and the matching bot receiver.
3. Keep `AXEX_BOT_API_KEY` configured during one release so older bot instances can still authenticate. Confirm token creation, quarantine release, outbox poll, and callback delivery.
4. Remove `AXEX_BOT_API_KEY` after every service has moved to directional keys. Rotate `CRON_SECRET` independently and update the Vercel Cron environment.
5. Rotate `SESSION_SECRET` only with a coordinated portal deployment; doing so invalidates all existing OAuth/session cookies.

## Rollback

- Roll back the portal application artifact without reversing additive migrations. Keep `verification_state` and locks intact.
- `0006` can be reversed only after the running portal no longer depends on its rate-limit/cache tables or outbox alert column.
- `0007` is intentionally forward-only; do not undo its lock correction during a code rollback. Use the authenticated quarantine-release flow for a user-specific release.
- If callback delivery is degraded, leave outbox rows intact; bot polling and Cron retry the same reference/payload using the existing lease mechanism.
- Never run `drizzle-kit push` against production.
