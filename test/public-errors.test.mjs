import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryableOAuthError,
  mapDiscordProviderError,
  mapOAuthErrorCode,
  mapVerificationErrorCode,
} from "../src/lib/public-errors.ts";

test("OAuth callback failures map to distinct user-facing reasons", () => {
  assert.equal(mapOAuthErrorCode("oauth_cancelled"), "authCancelled");
  assert.equal(mapOAuthErrorCode("oauth_state_invalid"), "authStateInvalid");
  assert.equal(mapOAuthErrorCode("oauth_token_exchange_failed"), "authTokenExchangeFailed");
  assert.equal(mapOAuthErrorCode("oauth_profile_lookup_failed"), "authProfileLookupFailed");
  assert.equal(mapOAuthErrorCode("oauth_identity_mismatch"), "authIdentityMismatch");
  assert.equal(mapOAuthErrorCode("oauth_token_expired"), "authTokenExpired");
  assert.equal(mapOAuthErrorCode("oauth_token_used"), "authTokenUsed");
  assert.equal(mapOAuthErrorCode("oauth_configuration_error"), "authConfiguration");
});

test("only explicit Discord access_denied is treated as cancellation", () => {
  assert.equal(mapDiscordProviderError("access_denied"), "oauth_cancelled");
  assert.equal(mapDiscordProviderError("server_error"), "oauth_provider_rejected");
  assert.equal(mapDiscordProviderError("temporarily_unavailable"), "oauth_provider_rejected");
  assert.equal(mapDiscordProviderError(null), null);
  assert.equal(mapOAuthErrorCode("auth"), "authUnknown");
  assert.notEqual(mapOAuthErrorCode("auth"), "authCancelled");
});

test("verification API failures map to their actual safe category", () => {
  assert.equal(mapVerificationErrorCode("identity_mismatch"), "sessionMismatch");
  assert.equal(mapVerificationErrorCode("session_required"), "authSessionMismatch");
  assert.equal(mapVerificationErrorCode("rate_limited"), "rateLimited");
  assert.equal(mapVerificationErrorCode("verification_unavailable"), "serviceUnavailable");
  assert.equal(mapVerificationErrorCode("expired"), "tokenExpired");
  assert.equal(mapVerificationErrorCode("used"), "tokenUsed");
  assert.equal(mapVerificationErrorCode("turnstile_invalid"), "turnstileInvalidRequest");
  assert.equal(mapVerificationErrorCode("turnstile_unavailable"), "captchaUnavailable");
});

test("expired and used links are not presented as retryable OAuth failures", () => {
  assert.equal(isRetryableOAuthError("authCancelled"), true);
  assert.equal(isRetryableOAuthError("authIdentityMismatch"), true);
  assert.equal(isRetryableOAuthError("authTokenExpired"), false);
  assert.equal(isRetryableOAuthError("authTokenUsed"), false);
  assert.equal(isRetryableOAuthError("authConfiguration"), false);
  assert.equal(isRetryableOAuthError("authRateLimited"), false);
});
