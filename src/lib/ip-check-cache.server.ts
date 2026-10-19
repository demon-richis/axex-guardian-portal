import { and, eq, gt } from "drizzle-orm";
import { createHmac } from "node:crypto";
import type { getDb } from "./db/client.server";
import { ipCheckCache } from "./db/schema.ts";
import { checkIp } from "./db/client.server.ts";

type PortalDb = ReturnType<typeof getDb>;
type IpCheckResult = Awaited<ReturnType<typeof checkIp>>;
type IpChecker = (ip: string) => Promise<IpCheckResult>;

function cacheKey(ip: string): string {
  const secret = process.env["SESSION_SECRET"] ?? "axex-local-ip-cache";
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export async function checkIpCached(
  db: PortalDb,
  ip: string,
  checker: IpChecker = checkIp,
  now = new Date(),
): Promise<IpCheckResult> {
  if (!ip) return checker(ip);

  const key = cacheKey(ip);
  const cached = (
    await db
      .select({
        status: ipCheckCache.status,
        isVpn: ipCheckCache.isVpn,
        type: ipCheckCache.type,
      })
      .from(ipCheckCache)
      .where(and(eq(ipCheckCache.ipHash, key), gt(ipCheckCache.expiresAt, now)))
      .limit(1)
  )[0];
  if (cached) {
    return { status: cached.status, isVPN: cached.isVpn, type: cached.type, ip };
  }

  const result = await checker(ip);
  if (result.status !== "unavailable") {
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db
      .insert(ipCheckCache)
      .values({
        ipHash: key,
        status: result.status,
        isVpn: result.isVPN,
        type: result.type,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [ipCheckCache.ipHash],
        set: {
          status: result.status,
          isVpn: result.isVPN,
          type: result.type,
          expiresAt,
        },
      });
  }
  return result;
}
