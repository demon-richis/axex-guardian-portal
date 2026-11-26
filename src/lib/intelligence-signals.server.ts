import { RiskSignalsSchema, type RiskSignals } from "./verification-level.server.ts";
import type { IntelligenceResult } from "./intelligence.server.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function riskSignalsFromIntelligence(result: IntelligenceResult | null): RiskSignals {
  if (!result) return {};
  const breakdown = record(result.breakdown);
  const network = record(breakdown["network"]);
  const username = record(breakdown["username"]);
  const alts = record(breakdown["alts"]);
  const networkData = record(network["data"]);
  const reasons = [
    ...strings(result.reasons),
    ...strings(network["reasons"]),
    ...strings(username["reasons"]),
    ...strings(alts["reasons"]),
  ].map((reason) => reason.toUpperCase());
  const blocklistHit = reasons.some((reason) => reason.startsWith("BLOCKLIST_"));
  const confirmedAltOfBanned = reasons.some(
    (reason) => reason.includes("SAME_IP_AS_FLAGGED") || reason.includes("ALT_OF_BANNED"),
  );
  const vpnFlag = reasons.some((reason) => /(?:VPN|PROXY|TOR)_IP/.test(reason));
  const sharedIp = reasons.some((reason) => /SHARED.*IP|IP.*SHARED|USERS_SAME_IP/.test(reason));
  const suspiciousUsername = strings(username["reasons"]).length > 0;
  const parsed = RiskSignalsSchema.safeParse({
    blocklistHit,
    knownBadIp:
      networkData["flagged"] === true ||
      reasons.some((reason) => reason.includes("ABUSE_IP")) ||
      blocklistHit,
    confirmedAltOfBanned,
    flaggedUserAlt:
      confirmedAltOfBanned ||
      reasons.some((reason) => reason.includes("FLAGGED_USER_ALT") || reason.includes("ALT_OF")),
    vpnFlag,
    sharedIp,
    suspiciousUsername,
  });
  return parsed.success ? parsed.data : {};
}
