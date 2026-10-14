import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db/client.server.ts";
import type { getDb as getDbType } from "./db/client.server";

type PortalDb = ReturnType<typeof getDbType>;
type OutboxRow = {
  id: number;
  token: string;
  payload: Record<string, unknown>;
  attempts: number;
};
type Fetcher = typeof fetch;
type WorkerConfig = { webhookUrl: string | null; apiKey: string | null };

const BOT_CALLBACK_TIMEOUT_MS = 8_000;

async function claimOne(db: PortalDb): Promise<{ claimId: string; row: OutboxRow } | null> {
  const claimId = randomUUID();
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id
      FROM bot_callback_outbox
      WHERE next_attempt_at <= now()
        AND (status = 'pending' OR (status = 'processing' AND lease_until <= now()))
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE bot_callback_outbox AS queued
    SET status = 'processing',
        claim_id = ${claimId},
        lease_until = now() + interval '60 seconds',
        attempts = queued.attempts + 1,
        updated_at = now()
    FROM candidate
    WHERE queued.id = candidate.id
    RETURNING queued.id, queued.token, queued.payload, queued.attempts
  `);
  const row = (result.rows as unknown as OutboxRow[])[0];
  return row ? { claimId, row } : null;
}

async function recordDelivery(
  db: PortalDb,
  claimed: { claimId: string; row: OutboxRow },
  delivered: boolean,
  errorCode: string | null,
): Promise<void> {
  if (delivered) {
    await db.execute(sql`
      WITH delivered AS (
        UPDATE bot_callback_outbox
        SET status = 'delivered', claim_id = NULL, lease_until = NULL,
            last_error = NULL, delivered_at = now(), updated_at = now()
        WHERE id = ${claimed.row.id}
          AND claim_id = ${claimed.claimId}
          AND status = 'processing'
        RETURNING token, payload
      )
      UPDATE verify_tokens AS token
      SET status = CASE
            WHEN COALESCE((delivered.payload ->> 'passed')::boolean, false) THEN 'completed'
            WHEN COALESCE((delivered.payload ->> 'vpnDetected')::boolean, false) THEN 'blocked'
            WHEN COALESCE((delivered.payload ->> 'locked')::boolean, false) THEN 'locked'
            ELSE 'failed'
          END,
          bot_acknowledged_at = now(),
          bot_error = NULL
      FROM delivered
      WHERE token.token = delivered.token
    `);
    return;
  }

  const delaySeconds = Math.min(3600, 2 ** Math.min(claimed.row.attempts, 11));
  await db.execute(sql`
    WITH retry AS (
      UPDATE bot_callback_outbox
      SET status = 'pending', claim_id = NULL, lease_until = NULL,
          next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
          last_error = ${errorCode ?? "BOT_CALLBACK_FAILED"},
          updated_at = now()
      WHERE id = ${claimed.row.id}
        AND claim_id = ${claimed.claimId}
        AND status = 'processing'
      RETURNING token
    )
    UPDATE verify_tokens AS token
    SET status = 'bot_update_pending',
        bot_error = ${errorCode ?? "BOT_CALLBACK_FAILED"}
    FROM retry
    WHERE token.token = retry.token
  `);
}

async function deliverOne(
  db: PortalDb,
  fetcher: Fetcher,
  config: WorkerConfig,
): Promise<"delivered" | "retry" | "empty"> {
  const claimed = await claimOne(db);
  if (!claimed) return "empty";
  let delivered = false;
  let errorCode: string | null = null;

  if (!config.webhookUrl || !config.apiKey) {
    errorCode = "BOT_CALLBACK_CONFIGURATION_MISSING";
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BOT_CALLBACK_TIMEOUT_MS);
    try {
      const response = await fetcher(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
        body: JSON.stringify(claimed.row.payload),
        signal: controller.signal,
      });
      delivered = response.ok;
      if (!response.ok) errorCode = `BOT_HTTP_${response.status}`;
    } catch (error) {
      errorCode =
        error instanceof Error && error.name === "AbortError" ? "BOT_TIMEOUT" : "BOT_NETWORK_ERROR";
    } finally {
      clearTimeout(timeout);
    }
  }

  await recordDelivery(db, claimed, delivered, errorCode);
  return delivered ? "delivered" : "retry";
}

export async function processBotCallbackOutboxWith(
  db: PortalDb,
  config: WorkerConfig,
  fetcher: Fetcher = fetch,
  maxJobs = 5,
): Promise<{ delivered: number; retrying: number }> {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(maxJobs)));
  let delivered = 0;
  let retrying = 0;
  for (let index = 0; index < safeLimit; index += 1) {
    const result = await deliverOne(db, fetcher, config);
    if (result === "empty") break;
    if (result === "delivered") delivered += 1;
    else retrying += 1;
  }
  return { delivered, retrying };
}

export async function processBotCallbackOutbox(maxJobs = 5): Promise<{
  delivered: number;
  retrying: number;
}> {
  return processBotCallbackOutboxWith(
    getDb(),
    {
      webhookUrl: process.env["BOT_WEBHOOK_URL"] ?? null,
      apiKey: process.env["AXEX_BOT_API_KEY"] ?? null,
    },
    fetch,
    maxJobs,
  );
}
