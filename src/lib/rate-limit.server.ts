import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { getDb } from "./db/client.server";
import { rateLimitBuckets } from "./db/schema.ts";

type PortalDb = ReturnType<typeof getDb>;

export type RateLimitBackend = {
  increment: (bucketHash: string, windowStart: Date, expiresAt: Date) => Promise<number>;
};

const memoryCounts = new Map<string, number>();

export const PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE = 60;

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function hashBucket(key: string): string {
  const secret = process.env["SESSION_SECRET"] ?? "axex-local-rate-limit";
  return createHmac("sha256", secret).update(key).digest("hex");
}

export function neonRateLimitBackend(db: PortalDb): RateLimitBackend {
  return {
    async increment(bucketHash, windowStart, expiresAt) {
      const rows = await db
        .insert(rateLimitBuckets)
        .values({ bucketHash, windowStart, count: 1, expiresAt })
        .onConflictDoUpdate({
          target: [rateLimitBuckets.bucketHash, rateLimitBuckets.windowStart],
          set: { count: sql`${rateLimitBuckets.count} + 1` },
        })
        .returning({ count: rateLimitBuckets.count });
      const count = rows[0]?.count;
      if (count === undefined) throw new Error("Rate limit update returned no count");
      return count;
    },
  };
}

function memoryRateLimitBackend(): RateLimitBackend {
  return {
    async increment(bucketHash, windowStart) {
      if (memoryCounts.size > 20_000) {
        for (const key of memoryCounts.keys()) {
          if (!key.endsWith(`:${windowStart.getTime()}`)) memoryCounts.delete(key);
        }
      }
      const key = `${bucketHash}:${windowStart.getTime()}`;
      const count = (memoryCounts.get(key) ?? 0) + 1;
      memoryCounts.set(key, count);
      return count;
    },
  };
}

async function consumeWithBackend(
  backend: RateLimitBackend,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number }> {
  if (
    !key ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1
  ) {
    throw new Error(
      "Rate limit parameters must contain a key, positive limit, and positive window",
    );
  }

  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const expiresAt = new Date(windowStartMs + windowMs * 2);
  const bucketHash = hashBucket(key);
  const count = await backend.increment(bucketHash, windowStart, expiresAt);
  if (count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - count };
}

export function consumeRateLimit(
  db: PortalDb,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  return consumeWithBackend(neonRateLimitBackend(db), key, limit, windowMs, now);
}

export function consumeConfiguredRateLimit(
  db: PortalDb | null,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const backend = process.env["RATE_LIMIT_BACKEND"] ?? "neon";
  if (backend === "memory") {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("RATE_LIMIT_BACKEND=memory is not permitted in production");
    }
    return consumeWithBackend(memoryRateLimitBackend(), key, limit, windowMs, now);
  }
  if (backend !== "neon") throw new Error("RATE_LIMIT_BACKEND must be neon or memory");
  if (!db) throw new Error("DATABASE_URL is required for the Neon rate limiter");
  return consumeRateLimit(db, key, limit, windowMs, now);
}
