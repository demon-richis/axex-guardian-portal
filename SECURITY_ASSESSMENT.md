# AxeX Verification Security Assessment — Portal Fixes

**Status at assessment snapshot (2026-10-13):** Locally implemented and validated; **not committed, pushed, or deployed at that time**. This historical status does not reflect later branch publication.
**Scope:** `demon-richis/axex-guardian-portal` plus read-only compatibility review of the local AxeX bot worktree.
**Safety:** All new portal regression tests use PGlite and mocked callback HTTP. No production database, member, role, bot API, OAuth session, webhook, secret, or configuration was contacted or modified.

## Executive summary

The portal contained two confirmed account-verification flaws: the callback treated a browser-supplied `passed` Boolean as proof, and the OAuth callback stored whichever Discord account completed OAuth without checking it against the target `userId` issued by the bot. Either could let a verification result be attributed to an unintended flow/account. The callback also lacked a single atomic operation joining one-time proof consumption to durable bot delivery, and the 32-bit reference ID had no database collision guard.

The local patch replaces the client Boolean with a short-lived, server-issued challenge whose answer digest is bound to the token, bot-issued Discord user ID, and guild. OAuth now binds only the bot-issued target account and cannot rebind an already-linked token. A single PostgreSQL statement consumes the proof and enqueues the immutable terminal callback; a durable outbox retries delivery. Reference IDs remain `AX-` plus eight uppercase hexadecimal characters, with a unique index, bounded collision retries, and a migration preflight that aborts rather than rewriting existing references.

**Validation:** Portal `npm run check`, `npm test` (13/13), `npm run build`, and `git diff --check` passed. The companion bot worktree also passed `npm run check`, `npm test` (18/18), and `git diff --check`. These are local/mocked results, not live integration results.

## Repository identity and reconciliation

| Worktree | Branch / HEAD | State |
|---|---|---|
| Portal | `main`, `1114a814c47041252d79303f0e659ec2971e0c5d` (`prevent duplicate verification tokens`) | 25 implementation/test files modified or untracked before this report; all remain local and unstaged |
| Bot | `main`, `ef16a728cf974493822a91cc19a52986f296013b` (`remove vsetup session timeout`) | Existing callback receipt/idempotency work remains local and uncommitted |

The earlier cited bot commit `6eb6c97` is **not present in the current local Git object database**. The checkout is shallow/grafted, so this does not establish whether that object exists remotely. The different suite totals are repository-specific: 13 portal regressions and 18 bot regressions, not competing counts for one suite.

## Prioritized findings

### P1 — Forged client result could claim success — **CONFIRMED; FIXED LOCALLY**

**Before:** `/api/callback` accepted client-controlled `passed`; the browser compared the answer and submitted that Boolean. A caller could bypass answer checking by sending `passed: true`.

**Change:** The callback uses a shared strict request schema requiring `token`, `challengeId`, and `answer`. Unknown fields—including either value of `passed` and client-provided `ipAddress`—are rejected. The server retrieves the stored answer digest and computes the result itself. The challenge is not returned with an answer or answer digest.

**Evidence:** The strict-schema regression rejects `{passed:true}` both alone and alongside proof-shaped fields; a service-level test supplies `passed:true` with a wrong answer and receives `passed:false` with one counted attempt.

### P1 — OAuth account could differ from bot-issued target — **CONFIRMED; FIXED LOCALLY**

**Before:** The OAuth callback wrote the returned Discord `user.id` to the token row without comparing it to the bot-issued `verify_tokens.user_id`. The eventual bot callback used the stored OAuth ID as its target, permitting an unintended account to be bound to the issued verification.

**Change:** OAuth binding is now conditional and atomic: the OAuth ID must be a valid Discord snowflake equal to the bot-issued `userId`; the token must be unexpired, unused, and in an eligible state; and an existing different binding cannot be replaced. Challenge issuance and submission also fail closed for legacy rows where `discordId !== userId`. The challenge-answer digest includes the token, target Discord ID, guild ID, and challenge ID.

**Evidence:** PGlite tests reject a different OAuth account, accept the intended account, reject subsequent rebinding, reject expired tokens, and refuse challenge issuance/submission on a mismatched legacy row. No live Discord OAuth exchange was made.

### P1 — Proof consumption and bot callback delivery could diverge — **CONFIRMED DESIGN GAP; FIXED LOCALLY, STAGING UNVERIFIED**

**Before:** One-time verification completion and delivery to the bot did not form a durable atomic handoff, leaving replay and lost-callback/retry behavior to be handled separately.

**Change:** A single PostgreSQL CTE conditionally consumes an unexpired, unused challenge and, for terminal outcomes only, inserts one outbox record with the original reference and exact result payload. It is protected by a unique reference key. The worker leases pending entries, retries failures with bounded exponential backoff, sends the same JSON payload/reference, and reconciles portal status only after bot acknowledgement. The existing bot contract is preserved: `guildId`, `userId`, `referenceId`, Boolean `passed`, and associated moderation/attempt fields; the bot authenticates the request using the configured shared API key in the header.

The complete outbox JSON body fields are `guildId`, `referenceId`, `userId` (the verified Discord snowflake, required to equal the bot-issued target), `discordId`, `discordTag`, `discordAvatar`, `passed`, `vpnDetected`, `vpnType`, `botDetected`, `honeypotTriggered`, `accountAgeDays`, `clickMs`, `flagged`, `flagReason`, `attempts`, `cooldownUntil`, `failureReason`, and `locked`. Delivery uses the existing API-key header; the report intentionally contains no callback URL or key value.

**Evidence:** PGlite regression tests cover sequential and `Promise.all` duplicate submissions (one attempt/one outbox record) and simulate a lost HTTP response followed by retry, asserting byte-identical JSON and reference values. The local bot suite separately exercises duplicate claims, changed-payload conflicts, retries, and mocked role updates. The cross-suite callback was not sent to a real bot or Discord guild.

### P2 — Short references could collide — **CONFIRMED DESIGN GAP; MITIGATED LOCALLY**

**Change:** Preserve the existing `AX-XXXXXXXX` format, add a unique reference index, retry only the specific unique-index conflict up to ten times, and fail closed if it cannot allocate. Migration `drizzle/0003_server_verified_challenge_outbox.sql` checks for duplicate non-null reference IDs **before** other DDL and aborts with existing values untouched.

**Evidence:** Embedded-Postgres tests verify unique enforcement and that the collision preflight aborts without changing duplicate legacy references. No production/staging reference data was queried, and no reference was renumbered.

### P2 — IP/body/origin trust boundaries — **PARTIALLY HARDENED; DEPLOYMENT ASSUMPTION REMAINS**

**Change:** The callback no longer falls back to a browser-submitted IP; its strict schema rejects `ipAddress`. Challenge and callback POSTs require an exact same-origin `Origin`, and both retain source-IP limits while adding per-token limits keyed by a SHA-256 fingerprint.

**Remaining risk:** `clientIp()` and the source-IP bucket still consume forwarded-IP headers. Their integrity depends on the hosting edge removing caller-supplied forwarding headers and setting trusted values. The test environment cannot establish that deployment property. The in-memory request buckets are per process; persistent per-token attempt/cooldown/lockout state remains the authoritative verification limit, but distributed rate limiting and deployment proxy trust are not verified.

### P2 — Challenge is not a strong human-CAPTCHA — **HYPOTHETICAL/RESIDUAL RISK**

The new random arithmetic multiple-choice challenge removes the forged-Boolean bypass and is checked server-side, but it is intentionally simple and automatable. It should not be represented as proof of human presence. If automated abuse resistance is a production requirement, integrate a server-verifiable CAPTCHA provider using securely configured staging/production credentials, or choose a stronger documented challenge. No provider credentials were available or used.

## Regression coverage

The 13 passing portal tests cover:

1. Random, answer-free challenge issuance and safe reuse of an active challenge.
2. Strict rejection of forged `passed` and client IP fields.
3. Same-origin acceptance and missing/foreign-Origin rejection.
4. Targeted nested PostgreSQL reference-collision error detection.
5. OAuth target binding, no rebinding, expiry rejection, and fail-closed legacy mismatch.
6. A forged `passed:true` with a wrong proof is denied and counted once; altered replay is rejected.
7. Escalating cooldowns and lockout on attempt three, with one terminal callback.
8. Correct proof succeeds once and creates one callback bound to the target identity/reference.
9. Expired and mismatched challenges are rejected without consuming attempts.
10. Concurrent duplicate submissions leave one attempt and one outbox item.
11. Lost callback response retries the exact same payload/reference and completes status on acknowledgement.
12. Migration preflight preserves existing duplicate reference IDs when it aborts.
13. New references retain the bot-compatible format and database uniqueness.

## Changed portal files

**Tracked edits:**

- `drizzle/meta/_journal.json`
- `package-lock.json`
- `package.json`
- `server.mjs`
- `src/lib/db/client.server.ts`
- `src/lib/db/schema.ts`
- `src/lib/rate-limit.server.ts`
- `src/routeTree.gen.ts` (generated by the local build)
- `src/routes/__root.tsx` (strict error-prop type correction required by the check)
- `src/routes/api/auth.callback.ts`
- `src/routes/api/bot.token.ts`
- `src/routes/api/callback.ts`
- `src/routes/api/verify.$token.ts`
- `src/routes/verify.tsx`

**New files:**

- `drizzle/0003_server_verified_challenge_outbox.sql`
- `drizzle/meta/0003_snapshot.json`
- `src/lib/bot-callback-outbox.server.ts`
- `src/lib/discord-identity.server.ts`
- `src/lib/reference-id.server.ts`
- `src/lib/verification-callback-body.ts`
- `src/lib/verification-challenge.server.ts`
- `src/lib/verification-submit.server.ts`
- `src/routes/api/bot.outbox.ts`
- `src/routes/api/challenge.ts`
- `test/verification-security.test.mjs`

No bot files were changed during this portal-fix pass; the bot worktree remains as previously locally modified and was revalidated.

## Validation results

| Repository | Command | Result |
|---|---|---|
| Portal | `npm run check` | Passed (ESLint + TypeScript) |
| Portal | `npm test` | 13 passed, 0 failed; PGlite and mocked callback HTTP only |
| Portal | `npm run build` | Passed (client and server bundles) |
| Portal | `git diff --check` | Passed; untracked files also scanned for trailing whitespace |
| Bot | `npm run check` | Passed (Node syntax checks) |
| Bot | `npm test` | 18 passed, 0 failed; local mocks/tests |
| Bot | `git diff --check` | Passed |

## Remaining gaps and exact safe-push gate

1. **No private staging integration was available.** Before push, provision an isolated portal database and isolated staging Discord guild/bot, configure the portal’s staging-only OAuth/API/webhook settings securely (do not send secrets in chat), and exercise a complete token → OAuth → challenge → success/lockout → outbox retry → bot acknowledgement flow. Confirm the OAuth identity is the same `userId` supplied by the bot and that a retry does not repeat role mutations. No production endpoints may be substituted.
2. **Before applying migration 0003 to any target database**, run a read-only duplicate-reference preflight in that target. If duplicates exist, stop: the migration deliberately aborts and preserves them; investigate and plan a separately reviewed resolution rather than rewriting active references. Apply and test the migration against a staging snapshot first.
3. **Confirm the deployment proxy’s forwarding-header policy** and whether each instance’s in-memory IP limits are acceptable; configure trusted proxy handling or distributed limiting where required.
4. After staging evidence and review, obtain explicit approval for any coordinated main-branch merge or deployment. At the time this assessment was written, the portal and bot changes were uncommitted and nothing had been pushed or deployed.

**Conclusion:** The confirmed Boolean and OAuth-target bypasses have local fixes with regression coverage. The persistent handoff/reference changes pass isolated database and mock tests. The fix is **not ready for a safe push yet** until the migration preflight and isolated end-to-end staging integration above succeed and are reviewed.
