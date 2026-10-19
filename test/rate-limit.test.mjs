import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/lib/db/schema.ts";
import { clientIp } from "../src/lib/client-ip.server.ts";
import { checkIpCached } from "../src/lib/ip-check-cache.server.ts";
import {
  consumeRateLimit,
  PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE,
} from "../src/lib/rate-limit.server.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(root, "drizzle");
const priorSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "rate-limit-test-secret-with-more-than-32-bytes";

async function freshDb() {
  const client = new PGlite();
  for (const file of [
    "0000_outgoing_azazel.sql",
    "0001_lowly_silver_samurai.sql",
    "0002_absent_goblin_queen.sql",
    "0003_server_verified_challenge_outbox.sql",
    "0004_durable_verification_state.sql",
    "0005_turnstile_challenge_timing.sql",
    "0006_shared_rate_limits_and_ip_cache.sql",
  ]) {
    const migration = await readFile(join(migrationDir, file), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

test("Vercel IP mode trusts only platform headers and ignores spoofed forwarding headers", () => {
  const request = (headers) => new Request("https://portal.test/api/check-ip", { headers });

  assert.equal(
    clientIp(
      request({
        "x-vercel-forwarded-for": "203.0.113.20",
        "x-real-ip": "203.0.113.17",
        "x-forwarded-for": "192.0.2.99",
        "cf-connecting-ip": "192.0.2.88",
      }),
      "vercel",
    ),
    "203.0.113.20",
  );
  assert.equal(
    clientIp(
      request({
        "x-vercel-forwarded-for": "203.0.113.18, 10.0.0.1",
        "x-forwarded-for": "192.0.2.99",
      }),
      "vercel",
    ),
    "203.0.113.18",
  );
  assert.equal(
    clientIp(
      request({ "x-forwarded-for": "192.0.2.99", "cf-connecting-ip": "192.0.2.88" }),
      "none",
    ),
    "",
  );
  assert.equal(
    clientIp(
      request({
        "cf-connecting-ip": "203.0.113.19",
        "x-forwarded-for": "192.0.2.99",
        "x-real-ip": "192.0.2.88",
      }),
      "cloudflare",
    ),
    "203.0.113.19",
  );
  assert.throws(() => clientIp(request({}), "untrusted"), /TRUSTED_PROXY_MODE/);
});

test("public status polling allows all 45 one-second polls within its rate window", async () => {
  const { client, db } = await freshDb();
  try {
    for (let poll = 0; poll < 45; poll += 1) {
      const result = await consumeRateLimit(
        db,
        "verify:token:polling-test",
        PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE,
        60_000,
        Date.UTC(2026, 9, 19, 17, 0, 0) + poll * 1_000,
      );
      assert.equal(result.allowed, true, `poll ${poll + 1} should be allowed`);
    }
  } finally {
    await client.close();
  }
});

test("fixed-window Neon rate limits are shared and persist only keyed hashes", async () => {
  const { client, db } = await freshDb();
  try {
    const now = Date.UTC(2026, 9, 19, 17, 0, 30);
    assert.deepEqual(await consumeRateLimit(db, "callback:ip:203.0.113.1", 2, 60_000, now), {
      allowed: true,
      remaining: 1,
    });
    assert.deepEqual(await consumeRateLimit(db, "callback:ip:203.0.113.1", 2, 60_000, now + 1), {
      allowed: true,
      remaining: 0,
    });
    assert.deepEqual(await consumeRateLimit(db, "callback:ip:203.0.113.1", 2, 60_000, now + 2), {
      allowed: false,
      retryAfterSeconds: 30,
    });
    assert.deepEqual(
      await consumeRateLimit(db, "callback:ip:203.0.113.1", 2, 60_000, now + 30_000),
      { allowed: true, remaining: 1 },
    );
    const rows = await db.select().from(schema.rateLimitBuckets);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => !row.bucketHash.includes("203.0.113.1")));
  } finally {
    await client.close();
  }
});

test("IP-check cache is shared, expires, and does not cache provider outages", async () => {
  const { client, db } = await freshDb();
  try {
    const now = new Date("2026-10-19T17:00:00.000Z");
    let lookups = 0;
    const clear = async (ip) => {
      lookups += 1;
      return { status: "clear", isVPN: false, type: null, ip };
    };
    await checkIpCached(db, "203.0.113.24", clear, now);
    await checkIpCached(db, "203.0.113.24", clear, new Date(now.getTime() + 1_000));
    assert.equal(lookups, 1);

    await checkIpCached(db, "203.0.113.24", clear, new Date(now.getTime() + 11 * 60_000));
    assert.equal(lookups, 2);

    const unavailable = async (ip) => {
      lookups += 1;
      return { status: "unavailable", isVPN: false, type: null, ip };
    };
    await checkIpCached(db, "203.0.113.25", unavailable, now);
    await checkIpCached(db, "203.0.113.25", unavailable, now);
    assert.equal(lookups, 4);

    const rows = await db.select().from(schema.ipCheckCache);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].ipHash, "203.0.113.24");
  } finally {
    await client.close();
  }
});

test.after(() => {
  if (priorSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSecret;
});
