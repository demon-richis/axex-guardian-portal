import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { verificationCallbackBody } from "../../lib/verification-callback-body.ts";

export const Route = createFileRoute("/api/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[callback] Challenge submission received");
        const { isSameOrigin, consumeConfiguredRateLimit } =
          await import("@/lib/rate-limit.server");
        if (!isSameOrigin(request)) {
          return Response.json({ success: false, error: "cross_origin_request" }, { status: 403 });
        }
        const [{ clientIp, getDb }, { unauthorizedSessionResponse, verifySession }] =
          await Promise.all([import("@/lib/db/client.server"), import("@/lib/session.server")]);
        let db;
        let requestLimit;
        try {
          db = getDb();
          const ip = clientIp(request) || "unknown";
          requestLimit = await consumeConfiguredRateLimit(db, `callback:ip:${ip}`, 12, 60_000);
        } catch (error) {
          console.error(
            "[callback] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json(
            { success: false, error: "verification_unavailable" },
            { status: 503 },
          );
        }
        if (!requestLimit.allowed) {
          return Response.json(
            {
              success: false,
              error: "rate_limited",
              retryAfterSeconds: requestLimit.retryAfterSeconds,
            },
            { status: 429, headers: { "Retry-After": String(requestLimit.retryAfterSeconds) } },
          );
        }
        const parsed = verificationCallbackBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ success: false, error: "invalid_request" }, { status: 400 });
        }
        if (!verifySession(request, parsed.data.token, parsed.data.discordId)) {
          return unauthorizedSessionResponse();
        }
        const tokenFingerprint = createHash("sha256").update(parsed.data.token).digest("hex");
        let tokenLimit;
        try {
          tokenLimit = await consumeConfiguredRateLimit(
            db,
            `callback:token:${tokenFingerprint}`,
            12,
            60_000,
          );
        } catch (error) {
          console.error(
            "[callback] Rate limit unavailable:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json(
            { success: false, error: "verification_unavailable" },
            { status: 503 },
          );
        }
        if (!tokenLimit.allowed) {
          return Response.json(
            {
              success: false,
              error: "rate_limited",
              retryAfterSeconds: tokenLimit.retryAfterSeconds,
            },
            { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } },
          );
        }

        try {
          const [{ verifyTokens }, { checkIpCached }, { submitVerificationChallenge }] =
            await Promise.all([
              import("@/lib/db/schema"),
              import("@/lib/ip-check-cache.server"),
              import("@/lib/verification-submit.server"),
            ]);
          const { token, challengeId, turnstileToken } = parsed.data;
          const row = (
            await db.select().from(verifyTokens).where(eq(verifyTokens.token, token)).limit(1)
          )[0];

          const serverIp = clientIp(request);
          const observedIp = serverIp;
          let isVpn = false;
          let vpnTypeDetected: string | null = null;

          // An identical duplicate is safe to acknowledge without repeating the IP
          // provider call; the submit service still binds it to the stored proof hash.
          const duplicate = Boolean(
            row?.challengeId === challengeId &&
            row.challengeConsumedAt &&
            row.challengeSubmissionHash,
          );
          if (!duplicate && row && !row.used && row.expiresAt.getTime() > Date.now()) {
            const ip = await checkIpCached(db, observedIp);
            if (ip.status === "unavailable") {
              console.error("[callback] Network security check unavailable; refusing verification");
              return Response.json(
                {
                  success: false,
                  error: "network_check_unavailable",
                  referenceId: row.referenceId,
                },
                { status: 503 },
              );
            }
            isVpn = ip.isVPN;
            vpnTypeDetected = ip.type;
          }

          const result = await submitVerificationChallenge(db, {
            token,
            challengeId,
            turnstileToken,
            discordId: parsed.data.discordId,
            discordTag: parsed.data.discordTag,
            discordAvatar: parsed.data.discordAvatar,
            clickMs: parsed.data.clickMs,
            timeout: parsed.data.timeout,
            failureReason: parsed.data.failureReason,
            honeypotTriggered: parsed.data.honeypotTriggered,
            honeypot: parsed.data.honeypot,
            vpnDetected: parsed.data.vpnDetected,
            vpnType: parsed.data.vpnType,
            observedIp,
            requestHostname: new URL(request.url).hostname,
            isVpn,
            vpnTypeDetected,
          });
          if (result.success && result.status === "bot_update_pending") {
            try {
              const { processBotCallbackOutbox } = await import("@/lib/bot-callback-outbox.server");
              const delivery = processBotCallbackOutbox(1, result.referenceId ?? undefined).catch(
                (error: unknown) => {
                  console.error(
                    "[callback] Immediate outbox delivery failed:",
                    error instanceof Error ? error.name : "unknown",
                  );
                },
              );
              if (process.env["VERCEL"] === "1") {
                try {
                  const { waitUntil } = await import("@vercel/functions");
                  waitUntil(delivery);
                } catch (error) {
                  console.error(
                    "[callback] Could not schedule post-response delivery:",
                    error instanceof Error ? error.name : "unknown",
                  );
                  await delivery;
                }
              } else {
                await delivery;
              }
            } catch (error) {
              console.error(
                "[callback] Immediate outbox delivery failed:",
                error instanceof Error ? error.name : "unknown",
              );
            }
          }
          const { httpStatus, ...body } = result;
          return Response.json(body, { status: result.success ? 200 : (httpStatus ?? 400) });
        } catch (error) {
          console.error(
            "[callback] Failed to process challenge:",
            error instanceof Error ? error.name : "unknown",
          );
          return Response.json(
            { success: false, error: "verification_unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
