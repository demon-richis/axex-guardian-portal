export type PublicErrorKind =
  | "invalid" | "used" | "timeout" | "lockout" | "auth" | "network"
  | "captchaUnavailable" | "turnstileRateLimited" | "turnstileInvalidRequest"
  | "turnstileIdentityMismatch" | "turnstileExpired" | "turnstileRetry" | "bot" | "generic"
  | "authCancelled" | "authStateInvalid" | "authCodeMissing" | "authProviderRejected"
  | "authTokenExchangeFailed" | "authProfileLookupFailed" | "authIdentityMismatch"
  | "authTokenExpired" | "authTokenUsed" | "authTokenInvalid" | "authConfiguration"
  | "authRateLimited" | "authServiceUnavailable" | "authSessionMismatch" | "authUnknown"
  | "rateLimited" | "serviceUnavailable" | "sessionMismatch" | "invalidRequest"
  | "tokenExpired" | "tokenUsed";

const OAUTH_ERROR_KINDS: Record<string, PublicErrorKind> = {
  oauth_cancelled: "authCancelled",
  oauth_state_invalid: "authStateInvalid",
  oauth_state_missing: "authStateInvalid",
  oauth_code_missing: "authCodeMissing",
  oauth_provider_rejected: "authProviderRejected",
  oauth_token_exchange_failed: "authTokenExchangeFailed",
  oauth_profile_lookup_failed: "authProfileLookupFailed",
  oauth_identity_mismatch: "authIdentityMismatch",
  oauth_token_expired: "authTokenExpired",
  oauth_token_used: "authTokenUsed",
  oauth_token_invalid: "authTokenInvalid",
  oauth_verification_locked: "lockout",
  oauth_configuration_error: "authConfiguration",
  oauth_rate_limited: "authRateLimited",
  oauth_service_unavailable: "authServiceUnavailable",
  oauth_session_mismatch: "authSessionMismatch",
  oauth_unknown: "authUnknown",
  config: "authConfiguration",
  // Older builds used "auth" for every OAuth failure. Never mislabel it as cancellation.
  auth: "authUnknown",
};

export function mapOAuthErrorCode(code: string | null | undefined): PublicErrorKind {
  if (!code) return "authUnknown";
  return OAUTH_ERROR_KINDS[code] ?? "authUnknown";
}

export function mapDiscordProviderError(code: string | null | undefined): string | null {
  if (!code) return null;
  return code === "access_denied" ? "oauth_cancelled" : "oauth_provider_rejected";
}

export function mapVerificationErrorCode(code: string | null | undefined): PublicErrorKind {
  switch (code) {
    case "invalid":
    case "invalid_token":
      return "invalid";
    case "expired":
      return "tokenExpired";
    case "used":
      return "tokenUsed";
    case "locked":
    case "attempts_exhausted":
    case "verification_locked":
      return "lockout";
    case "rate_limited":
      return "rateLimited";
    case "session_required":
    case "identity_required":
      return "authSessionMismatch";
    case "identity_mismatch":
      return "sessionMismatch";
    case "invalid_request":
    case "cross_origin_request":
      return "invalidRequest";
    case "network_check_unavailable":
    case "network_request_failed":
      return "network";
    case "verification_unavailable":
    case "challenge_unavailable":
    case "outbox_unavailable":
    case "service_unavailable":
    case "error":
      return "serviceUnavailable";
    case "turnstile_unavailable":
      return "captchaUnavailable";
    case "turnstile_retry":
      return "turnstileRetry";
    case "turnstile_invalid":
      return "turnstileInvalidRequest";
    case "invalid_or_expired_challenge":
      return "turnstileExpired";
    default:
      return "generic";
  }
}

export function isRetryableOAuthError(kind: PublicErrorKind): boolean {
  return [
    "authCancelled",
    "authStateInvalid",
    "authCodeMissing",
    "authProviderRejected",
    "authTokenExchangeFailed",
    "authProfileLookupFailed",
    "authIdentityMismatch",
    "authServiceUnavailable",
    "authUnknown",
  ].includes(kind);
}
