# Production Hardening Report

## Scope and outcome

The mounted workspace contains only the guardian portal repository. Portal work is implemented and committed in `af5ae0c` (`Harden portal verification and outbox handling`). The bot and account-intelligence repositories were not available, so their requested work and end-to-end cross-service validation remain outstanding.

## Verified pre-existing portal work

- Durable verification state already survived token expiry and was reset only through authenticated success/release paths.
- Server-side Turnstile verification was bound to the challenge and request context.
- OAuth state/session binding and security headers were already present.

## Completed portal changes

- Added shared Neon-backed fixed-window rate limits, with production memory fallback prohibited. Public status limits now permit the portal's 45 one-second polls.
- Added trusted proxy IP extraction: Vercel mode prefers `x-vercel-forwarded-for`, then `x-real-ip`; Cloudflare mode uses `cf-connecting-ip`; generic `x-forwarded-for` is ignored. The Vercel header behavior was checked against [Vercel's request headers documentation](https://vercel.com/docs/headers/request-headers).
- Added shared HMAC-keyed IP-check caching, with provider outages excluded from cache.
- Tightened verification attempt handling: invalid Turnstile proofs consume attempts, provider outages fail closed without consuming attempts, and accounts younger than seven days or honeypot hits are flags rather than standalone failure signals.
- Added directional API keys with a one-release legacy fallback, production environment validation, and session-gated disclosure of identity fields.
- Hardened callback outbox delivery with leased/idempotent claims, retries, stuck-row alerting, authenticated bot polling/Cron access, and Vercel `waitUntil` scheduling after the HTTP response.
- Added scheduled retention defaults that remove expired tokens and audit logs while preserving durable locks, pending callbacks, and state required for verification.
- Added migrations `0006` and `0007`, deployment guidance, and a staging checklist.

## Validation

- `npm test`: 50 passed, 0 failed.
- `npm run check`: passed (ESLint and TypeScript).
- `npm run build`: passed.
- `git diff --check`: passed.
- Migrations were exercised only against isolated PGlite test databases. No production database operation or deployment was performed.

## Remaining work and operator actions

1. Mount the bot repository to implement bot-side polling, directional receiver-key handling, guild logging/quarantine behavior, and validate the `honeypotTriggered` contract. The portal sends this field as a flag; its effect on bot behavior could not be confirmed here.
2. Mount the account-intelligence repository to implement its service changes and cross-repository contract tests.
3. Configure the production environment variables and trusted proxy mode, apply migrations `0006` and `0007`, and follow [DEPLOY.md](./DEPLOY.md) and [TEST_CHECKLIST.md](./TEST_CHECKLIST.md) in staging before rollout.
4. Confirm deployed Vercel request headers and `waitUntil` execution behavior in the actual project/runtime. Documentation was checked, but no live deployment was available.

The pre-existing worktree change to `package-lock.json` and the supplied untracked `prompt.md` were preserved and excluded from the implementation commit.
