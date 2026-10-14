import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { verificationCallbackBody } from "../../lib/verification-callback-body.ts";

export const Route = createFileRoute("/api/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("[callback] Challenge submission received");
        const { isSameOrigin, rateLimit, requestAddress } = await import("@/lib/rate-limit.server");
        if (!isSameOrigin(request)) {
          return Response.json({ success: false, error: "cross_origin_request" }, { status: 403 });
        }
        const requestLimit = rateLimit(`callback:${requestAddress(request)}`, 12, 60_000);
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
        const tokenFingerprint = createHash("sha256").update(parsed.data.token).digest("hex");
        const tokenLimit = rateLimit(`callback-token:${tokenFingerprint}`, 12, 60_000);
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
          const [{ getDb, checkIp, clientIp }, { verifyTokens }, { submitVerificationChallenge }] =
            await Promise.all([
              import("@/lib/db/client.server"),
              import("@/lib/db/schema"),
              import("@/lib/verification-submit.server"),
            ]);
          const { token, challengeId, answer } = parsed.data;
          const db = getDb();
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
            const ip = await checkIp(observedIp);
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
            answer,
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
            isVpn,
            vpnTypeDetected,
          });
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
