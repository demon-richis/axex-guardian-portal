import { createHash } from "node:crypto";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "axex_verify";

type SiteVerifyResponse = {
  success?: boolean;
  action?: string;
  cdata?: string;
  "error-codes"?: string[];
};

export type TurnstileResult =
  { ok: true } | { ok: false; error: "turnstile_invalid" | "turnstile_unavailable" };

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
    remoteIp?: string;
  },
  nowEnv: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!responseToken || responseToken.length > 2048) {
    return { ok: false, error: "turnstile_invalid" };
  }

  const secret = nowEnv["TURNSTILE_SECRET_KEY"]?.trim();
  if (nowEnv["NODE_ENV"] !== "production" && !secret && responseToken === "dev-bypass") {
    return { ok: true };
  }
  if (nowEnv["NODE_ENV"] !== "production" && !secret) {
    return { ok: false, error: "turnstile_invalid" };
  }
  if (!secret) return { ok: false, error: "turnstile_unavailable" };

  try {
    const body = new URLSearchParams({ secret, response: responseToken });
    if (context.remoteIp) body.set("remoteip", context.remoteIp);
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { ok: false, error: "turnstile_unavailable" };
    const result = (await response.json()) as SiteVerifyResponse;
    if (
      result.success !== true ||
      result.action !== TURNSTILE_ACTION ||
      result.cdata !==
        turnstileContext(context.token, context.discordId, context.guildId, context.challengeId)
    ) {
      return { ok: false, error: "turnstile_invalid" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "turnstile_unavailable" };
  }
}

export const turnstileAction = TURNSTILE_ACTION;
