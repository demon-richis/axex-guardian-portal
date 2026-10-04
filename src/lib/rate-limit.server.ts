type Bucket = { startedAt: number; count: number };

const buckets = new Map<string, Bucket>();

export function requestAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  if (buckets.size > 20_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.startedAt > windowMs * 2) buckets.delete(bucketKey);
    }
  }

  const current = buckets.get(key);
  const bucket =
    !current || now - current.startedAt >= windowMs ? { startedAt: now, count: 0 } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)),
    };
  }
  return { allowed: true, remaining: Math.max(0, limit - bucket.count) };
}
