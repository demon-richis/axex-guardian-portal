# Axex Privacy Policy

Last updated: 2026-11-26

## Summary

Axex is a Discord security system enabled by server owners. It processes Discord identity, verification, network, and risk signals to help those servers prevent abuse. This policy is a technical draft based on the current code. Replace the placeholders and have a qualified lawyer review it before public launch.

## 1. Who decides to enable Axex

A Discord server owner or administrator decides whether to install or enable Axex in a server. That server's settings control parts of the verification and security flow. Axex is not an independent way to join a server without the server's decision.

## 2. What Axex processes

Depending on the server and the flow, Axex processes:

- Discord user ID, username or tag, avatar, account creation date, and selected profile signals returned by Discord or supplied by the trusted bot flow.
- Guild ID, guild name, icon, member count, join context, roles, and configured verification settings.
- Verification tokens, attempts, cooldown and lock state, challenge state, result, reference IDs, eight-digit case IDs, quarantine status, review status, audit events, and callback-delivery state.
- An IP address when trusted proxy configuration makes one available, plus VPN, proxy, hosting, Tor, datacenter, shared-network, country, ASN, ISP, or similar network classifications returned by the configured checks.
- Risk scores, levels, recommendations, confidence, profile signals, alternate-account signals, join-wave signals, response timing, honeypot events, and reasons used by security rules.
- Turnstile challenge results. AxexOrbit uses signed sessions and replay identifiers; its repository does not show durable storage of browser fingerprints, raw mouse paths, IP addresses, challenge images, or answers.

Axex does not ask for or store your Discord password. The code does not show storage of Discord OAuth access or refresh tokens.

## 3. Why it is processed

Axex uses this information to authenticate the Discord account intended by a verification request, prevent replay and automated abuse, evaluate security risk, apply server-configured verification rules, keep a member in quarantine rather than immediately removing them where the configured flow does so, support moderator review, deliver a result back to the bot, and maintain security/audit records.

In plain language, the server's security and abuse-prevention purpose is the reason for processing. The server owner decides to enable that purpose for the server.

## 4. Who receives it

Information may be sent to or received from:

- Discord, for OAuth authentication and Discord API data.
- Cloudflare Turnstile, for challenge verification.
- ProxyCheck and the configured IP intelligence provider, which defaults in code to ipwho.is, for network classification.
- Neon/serverless PostgreSQL and the configured hosting/deployment services, including Vercel functions or cron where used.
- AxexOrbit, the separate Axex captcha service, when the server's high-risk flow enables it.
- The configured bot webhook and Discord server moderators, when a security result or audit record is delivered to the server.

[TO CONFIRM BY OWNER: exact production providers, regions, subprocessors, provider logs, and whether production URLs differ from the defaults in code.]

## 5. Retention

Retention depends on the component and its configuration:

- Portal verification tokens default to 30 days. Cleanup avoids deleting tokens with pending or processing callbacks.
- Portal audit logs default to 365 days.
- Delivered portal outbox records default to 30 days.
- Portal rate-limit buckets and IP-check cache rows expire as transient data.
- Intelligence cleanup defaults to 180 days for behavior events, 90 days for unflagged IP records, and 365 days for outcomes.
- AxexOrbit replay identifiers expire and are periodically removed.

The code does not show a complete purge for portal verification state, intelligence profile/alternate-account/risk-history tables, or bot cases and logs. [TO CONFIRM BY OWNER: production retention values, backup retention, and deletion schedules for these records.]

## 6. Security measures

The code includes signed and time-limited tokens, replay protection, server-side challenge checks, rate limits, bounded request timeouts, secret-based service authentication, redacted authorization/cookie logs in Orbit, database indexes for security queries, and role/callback retry handling. No security measure guarantees that every attack will be prevented.

## 7. Your choices and requests

You can stop using a verification page. If you cancel Discord authorization, Axex does not submit a verification result for that authorization attempt.

You may ask for access to or deletion of information held by Axex by contacting [CONTACT EMAIL] or using [SUPPORT SERVER URL]. Include the server name, your Discord user ID if you are comfortable sharing it, and the relevant case or reference ID. A server owner or moderator may also need to handle records stored in that server's bot database or Discord logs. Requests may be limited where a record must be kept for security, fraud prevention, legal obligations, or an active callback.

## 8. Children

Users must meet Discord's minimum age requirement. Axex is not directed to younger users. [TO CONFIRM BY OWNER: any additional age rules for the servers that enable Axex.]

## 9. International processing

Axex may process information in countries different from where you live because Discord, Cloudflare, ProxyCheck, the configured IP provider, hosting, databases, and other service locations may be international. [TO CONFIRM BY OWNER: production regions and transfer arrangements.]

## 10. Changes

We may update this policy when the code, providers, or operational practices change. The updated version will show a new “Last updated” date. A server owner may also need to notify members when the server changes its use of Axex.

## 11. Contact

Privacy questions and requests: [CONTACT EMAIL]. Discord support route: [SUPPORT SERVER URL]. Owner: [OWNER NAME].

## Changelog

- 2026-11-26: Initial technical draft based on the four-repository data inventory.
