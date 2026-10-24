import { createHash } from "node:crypto";
import { normalizePortalHostname } from "./security.ts";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "axex_verify";

type SiteVerifyResponse = {
  success?: boolean;
  action?: string;
  cdata?: string;
  hostname?: string;
  "error-codes"?: string[];
};

export type TurnstileResult =
  | { ok: true }
  | { ok: false; error: "turnstile_invalid" | "turnstile_retry" | "turnstile_unavailable" };

function logTurnstileFailure({
  errorCodes = [],
  expectedHostname,
  resultHostname = null,
  resultAction = null,
  cdataMatched = null,
}: {
  errorCodes?: string[];
  expectedHostname: string;
  resultHostname?: string | null;
  resultAction?: string | null;
  cdataMatched?: boolean | null;
}): void {
  console.warn(
    JSON.stringify({
      event: "turnstile_verify_failed",
      errorCodes,
      expectedHostname,
      resultHostname,
      expectedAction: TURNSTILE_ACTION,
      resultAction,
      cdataMatched,
    }),
  );
}

export function turnstileContext(
  token: string,
  discordId: string,
  guildId: string,
  challengeId: string,
): string {
  return createHash("sha256")
    .update(`${token}\u0000${discordId}\u0000${guildId}\u0000${challengeId}`)
    .digest("hex");
}

export async function verifyTurnstile(
  responseToken: string | undefined,
  context: {
    token: string;
    discordId: string;
    guildId: string;
    challengeId: string;
    requestHostname: string;
    remoteIp?: string;
  },
  nowEnv: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const expectedHostname = normalizePortalHostname(
    nowEnv["PORTAL_HOSTNAME"]?.trim() || context.requestHostname,
  );
  if (!responseToken || responseToken.length > 2048) {
    logTurnstileFailure({ expectedHostname });
    return { ok: false, error: "turnstile_invalid" };
  }

  const secret = nowEnv["TURNSTILE_SECRET_KEY"]?.trim();
  if (nowEnv["NODE_ENV"] !== "production" && !secret && responseToken === "dev-bypass") {
    return { ok: true };
  }
  if (!secret) {
    logTurnstileFailure({ errorCodes: ["missing-input-secret"], expectedHostname });
    return { ok: false, error: "turnstile_unavailable" };
  }

  try {
    const body = new URLSearchParams({ secret, response: responseToken });
    if (context.remoteIp) body.set("remoteip", context.remoteIp);
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logTurnstileFailure({
        errorCodes: [`http-status-${response.status}`],
        expectedHostname,
      });
      return { ok: false, error: "turnstile_unavailable" };
    }
    const result = (await response.json()) as SiteVerifyResponse;
    const errorCodes = Array.isArray(result["error-codes"])
      ? result["error-codes"].filter((code): code is string => typeof code === "string")
      : [];
    if (
      errorCodes.some((code) =>
        ["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"].includes(
          code,
        ),
      )
    ) {
      logTurnstileFailure({ errorCodes, expectedHostname });
      return { ok: false, error: "turnstile_unavailable" };
    }
    if (errorCodes.includes("timeout-or-duplicate")) {
      logTurnstileFailure({ errorCodes, expectedHostname });
      return { ok: false, error: "turnstile_retry" };
    }
    const cdataMatched =
      result.cdata ===
      turnstileContext(context.token, context.discordId, context.guildId, context.challengeId);
    if (
      result.success !== true ||
      result.action !== TURNSTILE_ACTION ||
      normalizePortalHostname(result.hostname ?? "") !== expectedHostname ||
      !cdataMatched
    ) {
      logTurnstileFailure({
        errorCodes,
        expectedHostname,
        resultHostname: result.hostname ?? null,
        resultAction: result.action ?? null,
        cdataMatched,
      });
      return { ok: false, error: "turnstile_invalid" };
    }
    return { ok: true };
  } catch {
    logTurnstileFailure({ errorCodes: ["network-error"], expectedHostname });
    return { ok: false, error: "turnstile_unavailable" };
  }
}

export const turnstileAction = TURNSTILE_ACTION;
