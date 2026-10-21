export type TurnstileClientErrorKind =
  | "turnstileInvalidRequest"
  | "turnstileRateLimited"
  | "turnstileIdentityMismatch"
  | "turnstileExpired"
  | "captchaUnavailable"
  | "generic";

export const TURNSTILE_ERROR_TEXT: Record<TurnstileClientErrorKind, [string, string]> = {
  turnstileInvalidRequest: [
    "Security check was blocked",
    "The challenge request was invalid. Please refresh and try again.",
  ],
  turnstileRateLimited: [
    "Too many requests",
    "Please wait a moment before trying the verification check again.",
  ],
  turnstileIdentityMismatch: [
    "Session mismatch",
    "Your Discord session changed during verification. Please restart the check and sign back in.",
  ],
  turnstileExpired: [
    "Challenge expired",
    "The security challenge expired; please complete it again.",
  ],
  captchaUnavailable: [
    "Verification service unavailable",
    "The secure challenge provider is temporarily unavailable. No attempt was used; please try again shortly.",
  ],
  generic: ["Something went wrong", "Please try again or contact server staff."],
};

export function shouldSubmitTurnstileToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

export function mapTurnstileError(
  error: string | null | undefined,
  retryAfterSeconds?: number,
): {
  kind: TurnstileClientErrorKind;
  title: string;
  description: string;
  retryAfterSeconds?: number;
} {
  const waitSeconds = Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Number(retryAfterSeconds))
    : 1;

  switch (error) {
    case "invalid_request":
    case "cross_origin_request":
      return {
        kind: "turnstileInvalidRequest",
        title: TURNSTILE_ERROR_TEXT.turnstileInvalidRequest[0],
        description: TURNSTILE_ERROR_TEXT.turnstileInvalidRequest[1],
      };
    case "rate_limited":
      return {
        kind: "turnstileRateLimited",
        title: TURNSTILE_ERROR_TEXT.turnstileRateLimited[0],
        description: `Please wait ${waitSeconds} seconds before trying again.`,
        retryAfterSeconds: waitSeconds,
      };
    case "verification_unavailable":
      return {
        kind: "captchaUnavailable",
        title: TURNSTILE_ERROR_TEXT.captchaUnavailable[0],
        description: TURNSTILE_ERROR_TEXT.captchaUnavailable[1],
      };
    case "identity_mismatch":
      return {
        kind: "turnstileIdentityMismatch",
        title: TURNSTILE_ERROR_TEXT.turnstileIdentityMismatch[0],
        description: TURNSTILE_ERROR_TEXT.turnstileIdentityMismatch[1],
      };
    case "invalid_or_expired_challenge":
      return {
        kind: "turnstileExpired",
        title: TURNSTILE_ERROR_TEXT.turnstileExpired[0],
        description: TURNSTILE_ERROR_TEXT.turnstileExpired[1],
      };
    default:
      return {
        kind: "generic",
        title: TURNSTILE_ERROR_TEXT.generic[0],
        description: TURNSTILE_ERROR_TEXT.generic[1],
      };
  }
}
