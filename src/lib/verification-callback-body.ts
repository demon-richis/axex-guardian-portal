import { z } from "zod";

export const verificationCallbackBody = z
  .object({
    token: z.string().min(1).max(200),
    challengeId: z.string().regex(/^[a-f0-9]{48}$/),
    turnstileToken: z.string().min(1).max(2048),
    discordId: z.string().max(40).optional(),
    discordTag: z.string().max(100).optional(),
    discordAvatar: z.string().max(200).nullable().optional(),
    vpnDetected: z.boolean().optional(),
    vpnType: z.string().max(100).nullable().optional(),
    clickMs: z.number().int().nonnegative().optional(),
    failureReason: z.enum(["WRONG_ANSWER", "TIMEOUT", "BOT_DETECTED", "VPN_BLOCKED"]).optional(),
    timeout: z.boolean().optional(),
    honeypotTriggered: z.boolean().optional(),
    honeypot: z.string().max(200).optional(),
  })
  .strict();
