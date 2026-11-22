import "dotenv/config";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

export { clientIp } from "../client-ip.server.ts";

export function getDb() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not configured");
  return drizzle(neon(url), { schema });
}

export function snowflakeToDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + 1420070400000);
}

type NetworkFailMode = "closed" | "open_flag";

export async function checkIp(
  ip: string,
  networkFailMode: NetworkFailMode = "closed",
): Promise<{
  status: "clear" | "blocked" | "unavailable";
  isVPN: boolean;
  type: string | null;
  ip: string;
  flagged?: boolean;
  reason?: string | null;
}> {
  if (!ip) {
    if (process.env["ALLOW_LOCALHOST_NETWORK_CHECK"] === "true") {
      console.warn(
        "[check-ip] No forwarded client IP; allowing explicit localhost development check",
      );
      return {
        status: "clear",
        isVPN: false,
        type: "localhost-dev",
        ip: "127.0.0.1",
        flagged: false,
        reason: null,
      };
    }
    return unavailableIpResult(ip, networkFailMode);
  }
  try {
    const key = process.env["PROXYCHECK_API_KEY"];
    if (!key) {
      console.warn(
        "[check-ip] PROXYCHECK_API_KEY is missing; ProxyCheck requests may be rate-limited",
      );
    }
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&asn=1${key ? `&key=${key}` : ""}`;
    const configuredTimeout = Number(process.env["PROXYCHECK_TIMEOUT_MS"]);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(1_000, Math.min(configuredTimeout, 10_000))
      : 4_000;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.error("[check-ip] Proxy lookup returned status:", res.status);
      return unavailableIpResult(ip, networkFailMode);
    }
    const json = (await res.json()) as Record<string, { proxy?: string; type?: string } | string>;
    const entry = json[ip];
    if (!entry || typeof entry === "string") return unavailableIpResult(ip, networkFailMode);
    const proxy = String(entry.proxy ?? "").toLowerCase();
    const type = entry.type ? String(entry.type) : null;
    const normalizedType = type?.toLowerCase() ?? "";
    const isVPN = proxy === "yes" || normalizedType === "vpn" || normalizedType.includes("proxy");
    return { status: isVPN ? "blocked" : "clear", isVPN, type, ip, flagged: false, reason: null };
  } catch (error) {
    console.error(
      "[check-ip] Proxy lookup failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return unavailableIpResult(ip, networkFailMode);
  }
}

function unavailableIpResult(ip: string, networkFailMode: NetworkFailMode) {
  if (networkFailMode === "open_flag") {
    return {
      status: "clear" as const,
      isVPN: false,
      type: null,
      ip,
      flagged: true,
      reason: "Network check unavailable",
    };
  }
  return {
    status: "unavailable" as const,
    isVPN: false,
    type: null,
    ip,
    flagged: false,
    reason: null,
  };
}

export function redirectUri(request: Request): string {
  return process.env["DISCORD_REDIRECT_URI"] ?? `${new URL(request.url).origin}/api/auth/callback`;
}
