import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/lib/db/schema.ts";
import { runPortalRetention } from "../src/lib/retention.server.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(root, "drizzle");

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
    "0007_lock_legacy_exhausted_verification_state.sql",
  ]) {
    const migration = await readFile(join(migrationDir, file), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

test("scheduled retention removes expired tokens and audit logs but preserves locks and pending outbox", async () => {
  const { client, db } = await freshDb();
  try {
    const now = new Date("2026-10-19T17:00:00.000Z");
    const old = new Date(now.getTime() - 400 * 86_400_000);
    await db.insert(schema.verifyTokens).values([
      {
        token: "expired-unreferenced-token",
        userId: "retained-locked-user",
        guildId: "retention-guild",
        guildName: "Retention",
        expiresAt: old,
        createdAt: old,
        status: "locked",
        used: true,
        attempts: 3,
      },
      {
        token: "expired-pending-callback",
        userId: "pending-user",
        guildId: "retention-guild",
        guildName: "Retention",
        expiresAt: old,
        createdAt: old,
        status: "bot_update_pending",
        used: true,
        attempts: 3,
      },
    ]);
    await db.insert(schema.verificationState).values({
      guildId: "retention-guild",
      userId: "retained-locked-user",
      attempts: 3,
      lockedAt: old,
      updatedAt: old,
    });
    await db.insert(schema.botCallbackOutbox).values({
      token: "old-delivered-callback",
      referenceId: "AX-RETENTION2",
      payload: { referenceId: "AX-RETENTION2" },
      status: "delivered",
      createdAt: old,
      updatedAt: old,
      deliveredAt: old,
      nextAttemptAt: old,
    });
    await db.insert(schema.botCallbackOutbox).values({
      token: "expired-pending-callback",
      referenceId: "AX-RETENTION1",
      payload: { referenceId: "AX-RETENTION1" },
      status: "pending",
      createdAt: old,
      updatedAt: old,
      nextAttemptAt: now,
    });
    await db.insert(schema.auditLogs).values([
      {
        guildId: "retention-guild",
        eventType: "OLD_AUDIT",
        createdAt: old,
      },
      {
        guildId: "retention-guild",
        eventType: "RECENT_AUDIT",
        createdAt: new Date(now.getTime() - 10 * 86_400_000),
      },
    ]);

    const result = await runPortalRetention(
      db,
      { TOKEN_RETENTION_DAYS: "30", AUDIT_LOG_RETENTION_DAYS: "365" },
      now,
    );

    assert.equal(result.tokensDeleted, 1);
    assert.equal(result.auditLogsDeleted, 1);
    assert.equal(result.outboxDeleted, 1);
    assert.equal(result.transientRowsDeleted, 0);
    assert.equal((await db.select().from(schema.verifyTokens)).length, 1);
    assert.equal((await db.select().from(schema.auditLogs))[0].eventType, "RECENT_AUDIT");
    assert.ok((await db.select().from(schema.verificationState))[0].lockedAt);
    const outboxRows = await db.select().from(schema.botCallbackOutbox);
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].status, "pending");
  } finally {
    await client.close();
  }
});

test("scheduled retention rejects invalid retention configuration instead of silently changing policy", async () => {
  const { client, db } = await freshDb();
  try {
    await assert.rejects(
      runPortalRetention(db, { TOKEN_RETENTION_DAYS: "0" }),
      /TOKEN_RETENTION_DAYS/,
    );
  } finally {
    await client.close();
  }
});
