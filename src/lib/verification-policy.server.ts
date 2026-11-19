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
  vpnAction: z.enum(["allow", "flag", "challenge", "block"]),
  honeypotAction: z.enum(["flag", "quarantine", "kick", "ban"]),
  newAccountDays: z.number().int().min(0).max(365),
  newAccountAction: z.enum(["flag", "raise_level", "block"]),
  networkFailMode: z.enum(["closed", "open_flag"]),
  verifyTimeoutSeconds: z.number().int().min(15).max(900),
  reviewEnabled: z.boolean(),
  reviewTimeoutHours: z.number().int().min(1).max(168),
  raidAction: z.enum(["flag", "force_review_new_accounts", "stricter_attempts"]),
  autoVerifyEnabled: z.boolean(),
});

export type VerificationPolicy = z.infer<typeof PolicySchema>;

export function normalizeVerificationPolicy(input: unknown): VerificationPolicy {
  const candidate = input && typeof input === "object" ? input : {};
  return PolicySchema.parse({ ...DEFAULT_VERIFICATION_POLICY, ...candidate });
}

export function parseOptionalVerificationPolicy(input: unknown): VerificationPolicy | null {
  if (input == null) return null;
  return normalizeVerificationPolicy(input);
}
