import { z } from "zod";

export const VERIFICATION_LEVELS = ["auto", "low", "medium", "high", "critical"] as const;
export const VerificationLevelSchema = z.enum(VERIFICATION_LEVELS);
export type VerificationLevel = z.infer<typeof VerificationLevelSchema>;

export const PROFILE_SIGNAL_NAMES = [
  "avatarDecoration",
  "nameplate",
  "collectible",
  "primaryGuild",
  "nitro",
  "banner",
  "bio",
] as const;

export const ProfileSignalsSchema = z
  .object({
    avatarDecoration: z.boolean().optional(),
    nameplate: z.boolean().optional(),
    collectible: z.boolean().optional(),
    primaryGuild: z.boolean().optional(),
    nitro: z.boolean().optional(),
    banner: z.boolean().optional(),
    bio: z.boolean().optional(),
  })
  .strict();

export type ProfileSignals = z.infer<typeof ProfileSignalsSchema>;

export const RiskSignalsSchema = z
  .object({
    defaultAvatar: z.boolean().optional(),
    flaggedUserAlt: z.boolean().optional(),
    raidBurst: z.boolean().optional(),
    sharedIp: z.boolean().optional(),
    suspiciousUsername: z.boolean().optional(),
    confirmedAltOfBanned: z.boolean().optional(),
    knownBadIp: z.boolean().optional(),
    blocklistHit: z.boolean().optional(),
    vpnFlag: z.boolean().optional(),
  })
  .strict();

export type RiskSignals = z.infer<typeof RiskSignalsSchema>;

const levelRank: Record<VerificationLevel, number> = {
  auto: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function maxVerificationLevel(
  first: VerificationLevel,
  second: VerificationLevel,
): VerificationLevel {
  return levelRank[first] >= levelRank[second] ? first : second;
}

export function hasPositiveProfileSignal(signals: ProfileSignals): boolean {
  return PROFILE_SIGNAL_NAMES.some((signal) => signals[signal] === true);
}

export function classifyVerificationLevel(input: {
  initialLevel: VerificationLevel;
  accountAgeDays: number;
  newAccountDays: number;
  riskSignals: RiskSignals;
  vpnDetected: boolean;
  honeypotTriggered?: boolean;
  intelligenceRecommendation?: string | null;
  allowAuto?: boolean;
  autoCandidate?: boolean;
  profileSignals?: ProfileSignals;
}): VerificationLevel {
  const { riskSignals } = input;
  const defaultAvatar = riskSignals.defaultAvatar === true;
  const vpn = input.vpnDetected || riskSignals.vpnFlag === true;
  const hardCritical =
    input.honeypotTriggered === true ||
    riskSignals.confirmedAltOfBanned === true ||
    riskSignals.knownBadIp === true ||
    riskSignals.blocklistHit === true;

  if (hardCritical) return "critical";

  let detectedLevel: VerificationLevel = "low";
  if (
    (input.accountAgeDays < 1 && defaultAvatar) ||
    (vpn && input.accountAgeDays < 7) ||
    riskSignals.flaggedUserAlt === true ||
    riskSignals.raidBurst === true
  ) {
    detectedLevel = "high";
  } else if (
    input.accountAgeDays < input.newAccountDays ||
    defaultAvatar ||
    vpn ||
    riskSignals.sharedIp === true ||
    riskSignals.suspiciousUsername === true ||
    input.intelligenceRecommendation === "challenge"
  ) {
    detectedLevel = "medium";
  }

  const baseLevel = input.initialLevel === "auto" ? "low" : input.initialLevel;
  const escalated = maxVerificationLevel(detectedLevel, baseLevel);
  const hasRedFlag =
    vpn ||
    input.honeypotTriggered === true ||
    riskSignals.confirmedAltOfBanned === true ||
    riskSignals.flaggedUserAlt === true ||
    riskSignals.raidBurst === true ||
    riskSignals.blocklistHit === true ||
    riskSignals.knownBadIp === true ||
    riskSignals.sharedIp === true ||
    riskSignals.suspiciousUsername === true;
  const recommendationIsRedFlag = input.intelligenceRecommendation === "challenge";

  if (
    input.allowAuto === true &&
    input.autoCandidate === true &&
    hasPositiveProfileSignal(input.profileSignals ?? {}) &&
    input.accountAgeDays >= 1 &&
    !hasRedFlag &&
    !recommendationIsRedFlag &&
    levelRank[escalated] <= levelRank.medium
  ) {
    return "auto";
  }
  return escalated;
}
