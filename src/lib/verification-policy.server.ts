import { z } from "zod";

export const DEFAULT_VERIFICATION_POLICY = {
  maxAttempts: 3,
  cooldownsSeconds: [180, 10_800] as [number, number],
  vpnAction: "block" as const,
  honeypotAction: "quarantine" as const,
  newAccountDays: 7,
  newAccountAction: "flag" as const,
  networkFailMode: "closed" as const,
  verifyTimeoutSeconds: 60,
  reviewEnabled: false,
  reviewTimeoutHours: 24,
  raidAction: "flag" as const,
  autoVerifyEnabled: false,
};

const PolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  cooldownsSeconds: z.tuple([
    z.number().int().min(1).max(86_400),
    z.number().int().min(1).max(604_800),
  ]),
  vpnAction: z.enum(["allow", "flag", "block"]),
  honeypotAction: z.enum(["flag", "quarantine", "kick", "ban"]),
  newAccountDays: z.number().int().min(0).max(365),
  newAccountAction: z.enum(["flag", "review_flag", "block"]),
  networkFailMode: z.enum(["closed", "open_flag"]),
  verifyTimeoutSeconds: z.number().int().min(15).max(900),
  reviewEnabled: z.boolean(),
  reviewTimeoutHours: z.number().int().min(1).max(168),
  raidAction: z.enum(["flag", "force_review_new_accounts", "stricter_attempts"]),
  autoVerifyEnabled: z.boolean(),
});

export type VerificationPolicy = z.infer<typeof PolicySchema>;

export function normalizeVerificationPolicy(input: unknown): VerificationPolicy {
  const source = input && typeof input === "object" ? input : {};
  const candidate = { ...(source as Record<string, unknown>) };
  if (candidate["vpnAction"] === "challenge") candidate["vpnAction"] = "flag";
  if (candidate["newAccountAction"] === "raise_level")
    candidate["newAccountAction"] = "review_flag";
  return PolicySchema.parse({ ...DEFAULT_VERIFICATION_POLICY, ...candidate });
}

export function parseOptionalVerificationPolicy(input: unknown): VerificationPolicy | null {
  if (input == null) return null;
  return normalizeVerificationPolicy(input);
}

export function policyForToken(input: unknown): VerificationPolicy {
  try {
    return normalizeVerificationPolicy(input);
  } catch {
    return DEFAULT_VERIFICATION_POLICY;
  }
}

export function policyForVerificationLevel(
  input: unknown,
  level: "auto" | "low" | "medium" | "high" | "critical",
): VerificationPolicy {
  const policy = policyForToken(input);
  if (level !== "medium") return policy;
  return {
    ...policy,
    maxAttempts: Math.max(1, policy.maxAttempts - 1),
    cooldownsSeconds: policy.cooldownsSeconds.map((seconds) => Math.min(604_800, seconds * 2)) as [
      number,
      number,
    ],
  };
}

export function cooldownSecondsForAttempt(policy: VerificationPolicy, attempt: number): number {
  const index = Math.max(0, Math.min(policy.cooldownsSeconds.length - 1, attempt - 1));
  return policy.cooldownsSeconds[index] ?? policy.cooldownsSeconds.at(-1) ?? 0;
}
