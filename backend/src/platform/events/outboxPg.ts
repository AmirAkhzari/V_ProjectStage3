import type pg from 'pg';
import type { EventEnvelope } from './envelope.js';
import type { OutboxRecord, OutboxStore, OutboxWriter } from './outbox.js';
import type { TenantTx } from '../db/tenant.js';

interface OutboxRow {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  distributor_id: string | null;
  payload: unknown;
  occurred_at: Date;
  attempts: number;
}

function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    id: row.id,
    type: row.event_type,
    version: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    distributorId: row.distributor_id,
    occurredAt: row.occurred_at,
    payload: row.payload,
  };
}

/** Inserts `platform.outbox_events` on the caller's tenant transaction (TXN-OUT-01). */
export class PgOutboxWriter implements OutboxWriter<TenantTx> {
  async publish(tx: TenantTx, event: EventEnvelope): Promise<void> {
    await tx.client.query(
      `INSERT INTO platform.outbox_events (
         id, event_type, event_version, aggregate_type, aggregate_id, distributor_id,
         payload, occurred_at, attempts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
      [
        event.id,
        event.type,
        event.version,
        event.aggregateType,
        event.aggregateId,
        event.distributorId,
        JSON.stringify(event.payload ?? {}),
        event.occurredAt,
      ],
    );
  }
}

const CLAIM_SQL = `
UPDATE platform.outbox_events AS o
SET next_attempt_at = $1::timestamptz + interval '5 minutes'
WHERE o.id IN (
  SELECT id FROM platform.outbox_events
  WHERE published_at IS NULL
    AND dead_lettered_at IS NULL
    AND (next_attempt_at IS NULL OR next_attempt_at <= $1::timestamptz)
  ORDER BY occurred_at
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
RETURNING o.id, o.event_type, o.event_version, o.aggregate_type, o.aggregate_id,
          o.distributor_id, o.payload, o.occurred_at, o.attempts
`;

/** Worker-side store: `FOR UPDATE SKIP LOCKED` claims (Architect B-1). */
export class PgOutboxStore implements OutboxStore {
  constructor(private readonly pool: pg.Pool) {}

  async claimBatch(limit: number, now: Date): Promise<OutboxRecord[]> {
    const result = await this.pool.query<OutboxRow>(CLAIM_SQL, [now, limit]);
    return result.rows.map((row) => ({ event: toEnvelope(row), attempts: row.attempts }));
  }

  async markPublished(eventId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE platform.outbox_events
       SET published_at = $2, next_attempt_at = NULL, last_error = NULL
       WHERE id = $1`,
      [eventId, at],
    );
  }

  async markFailed(eventId: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE platform.outbox_events
       SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3
       WHERE id = $1`,
      [eventId, error, nextAttemptAt],
    );
  }

  async moveToDeadLetter(eventId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE platform.outbox_events
       SET attempts = attempts + 1, last_error = $2, dead_lettered_at = now()
       WHERE id = $1`,
      [eventId, error],
    );
  }

  async release(eventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE platform.outbox_events SET next_attempt_at = now() WHERE id = $1`,
      [eventId],
    );
  }
}
