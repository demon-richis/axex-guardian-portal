type VerificationLevel = "auto" | "low" | "medium" | "high" | "critical";

export function turnstileSiteKeyForLevel(
  level: VerificationLevel,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const standardSiteKey = environment["TURNSTILE_SITE_KEY"]?.trim() ?? "";
  if (level !== "medium") return standardSiteKey;

  return (
    environment["TURNSTILE_INTERACTIVE_SITE_KEY"]?.trim() ||
    standardSiteKey
  );
}
