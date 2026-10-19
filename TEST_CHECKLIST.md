# Staging verification checklist

Run this only against an isolated staging Neon database, staging Discord application, and staging guild. Confirm that quarantine assigns the configured quarantine role and never kicks a member.

## Setup

- [ ] Deploy the portal with staging `DATABASE_URL`, Discord OAuth values, Turnstile keys, `SESSION_SECRET`, directional bot keys, `CRON_SECRET`, and `TRUSTED_PROXY_MODE=vercel`.
- [ ] Apply pending Drizzle migrations before deploying the application.
- [ ] Confirm the bot polls `/api/bot/outbox` and can reach the portal.
- [ ] Confirm the guild has a log channel, verified role, and quarantine role configured.
- [ ] Keep one test account at least seven days old and one younger than seven days.

## Verification rules

- [ ] **Success:** issue a token, complete OAuth as the bot-issued Discord user, pass Turnstile, and confirm the verified role and guild log entry.
- [ ] **Identity binding:** try OAuth with a different Discord account; confirm the portal refuses to bind or submit the result.
- [ ] **Failure one:** submit an invalid Turnstile response; confirm attempt 1 and a three-minute cooldown.
- [ ] **Cross-token cooldown:** request a new token during cooldown; confirm no fresh challenge is issued and attempts remain 1.
- [ ] **Failure two:** after the first cooldown, submit another invalid proof; confirm attempt 2 and a three-hour cooldown.
- [ ] **Expiry regression:** after the token expires (10+ minutes), request a new token before the three-hour cooldown ends; confirm the cooldown and attempt count persist.
- [ ] **Failure three:** after the second cooldown, submit another invalid proof; confirm durable lock and quarantine across newly issued tokens.
- [ ] **Idempotency:** replay the same terminal callback; confirm one bot callback/role mutation and `locked: true` for a locked result.
- [ ] **Release:** release the quarantined member through the bot's authenticated release command; confirm attempts, cooldown, and lock reset and the release is audited.
- [ ] **VPN/proxy:** submit from a controlled VPN/proxy test source; confirm immediate quarantine and no kick.
- [ ] **New account:** verify the account younger than seven days; confirm a suspicious flag/log entry, successful verification, zero consumed attempts, and no kick.
- [ ] **Honeypot:** submit the honeypot signal with a valid Turnstile proof; confirm it only flags and does not fail or consume attempts.
- [ ] **Turnstile outage:** make siteverify unavailable in staging; confirm a clear unavailable message, no attempt consumed, and retry remains possible.
- [ ] **Rate limit:** exceed per-IP and per-token limits on challenge, callback, telemetry, check-IP, auth, and token-status endpoints; confirm 429 responses and `Retry-After`.
- [ ] **Privacy:** request `/api/verify/:token` before OAuth; confirm Discord ID, username, avatar, and user ID are absent. Repeat after OAuth and confirm only the matching signed session receives identity details.
- [ ] **IP trust:** send forged `x-forwarded-for` and `cf-connecting-ip` headers; confirm the portal uses only configured Vercel client-IP headers.

## Delivery resilience and operations

- [ ] **Portal callback outage:** make the bot receiver unavailable after a terminal result; confirm the outbox remains pending and retries with the same reference and payload.
- [ ] **Late recovery:** restore the bot receiver; confirm the next bot poll grants the role and the outbox acknowledges delivery.
- [ ] **Three-way race:** trigger immediate portal delivery while bot polling and Cron run; confirm one bot callback and one role mutation.
- [ ] **Stuck outbox:** leave a row pending for more than five minutes; confirm one `OUTBOX_STUCK` audit event and structured warning log.
- [ ] **Retention:** run authenticated Cron; confirm tokens older than configured retention are removed unless an outbox callback is pending, audit logs older than configured retention are removed, and verification-state locks remain.
- [ ] **Bot restart:** restart the bot mid-verification; confirm the durable outbox is delivered after the bot poll resumes.
- [ ] **Headers:** confirm CSP, HSTS, `no-store` API caching, no-referrer, and other configured security headers on portal/API responses.

Bot restart, quarantine release, role/log behavior, and the polling loop must be exercised once the bot repository changes are available.
