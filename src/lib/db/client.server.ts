import "dotenv/config";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function getDb() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not configured");
  return drizzle(neon(url), { schema });
}

export function snowflakeToDate(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + 1420070400000);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    ""
  );
}

export async function checkIp(ip: string): Promise<{
  status: "clear" | "blocked" | "unavailable";
  isVPN: boolean;
  type: string | null;
  ip: string;
}> {
  if (!ip) return { status: "unavailable", isVPN: false, type: null, ip };
  try {
    const key = process.env["PROXYCHECK_API_KEY"];
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&asn=1${key ? `&key=${key}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[check-ip] Proxy lookup returned status:", res.status);
      return { status: "unavailable", isVPN: false, type: null, ip };
    }
    const json = (await res.json()) as Record<string, { proxy?: string; type?: string } | string>;
    const entry = json[ip];
    if (!entry || typeof entry === "string")
      return { status: "unavailable", isVPN: false, type: null, ip };
    const proxy = String(entry.proxy ?? "").toLowerCase();
    const type = entry.type ? String(entry.type) : null;
    const normalizedType = type?.toLowerCase() ?? "";
    const isVPN = proxy === "yes" || normalizedType === "vpn" || normalizedType.includes("proxy");
    return { status: isVPN ? "blocked" : "clear", isVPN, type, ip };
  } catch (error) {
    console.error("[check-ip] Proxy lookup failed:", error);
    return { status: "unavailable", isVPN: false, type: null, ip };
  }
}

export function redirectUri(request: Request): string {
  return process.env["DISCORD_REDIRECT_URI"] ?? `${new URL(request.url).origin}/api/auth/callback`;
}
