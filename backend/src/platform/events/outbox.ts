import type { EventEnvelope } from './envelope.js';

/**
 * Write side: `publish(tx, event)` inserts into `platform.outbox_events` inside the caller's
 * transaction (P0-E5-T1). The table is not created in Foundation (12 empty schemas, DECISION_LOG
 * §G F-6), so only the contract is defined here.
 */
export interface OutboxWriter<TTx> {
  publish(tx: TTx, event: EventEnvelope): Promise<void>;
}

export interface OutboxRecord {
  event: EventEnvelope;
  attempts: number;
}

/** Read side used by the relay. The Postgres implementation claims rows with `FOR UPDATE SKIP LOCKED`. */
export interface OutboxStore {
  claimBatch(limit: number, now: Date): Promise<OutboxRecord[]>;
  markPublished(eventId: string, at: Date): Promise<void>;
  markFailed(eventId: string, error: string, nextAttemptAt: Date): Promise<void>;
  moveToDeadLetter(eventId: string, error: string): Promise<void>;
  /** Returns a claimed event to the queue without counting an attempt. */
  release(eventId: string): Promise<void>;
}

interface StoredRecord extends OutboxRecord {
  publishedAt: Date | null;
  nextAttemptAt: Date;
  lastError: string | null;
  deadLettered: boolean;
  claimed: boolean;
}

export class InMemoryOutboxStore implements OutboxStore {
  private readonly records: StoredRecord[] = [];

  add(event: EventEnvelope): void {
    this.records.push({
      event,
      attempts: 0,
      publishedAt: null,
      nextAttemptAt: event.occurredAt,
      lastError: null,
      deadLettered: false,
      claimed: false,
    });
  }

  snapshot(): readonly Readonly<StoredRecord>[] {
    return this.records.map((r) => ({ ...r }));
  }

  claimBatch(limit: number, now: Date): Promise<OutboxRecord[]> {
    const pending = this.records
      .filter((r) => !r.publishedAt && !r.deadLettered)
      .sort((a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime());
    // Per-aggregate ordering: an event is claimable only if no earlier event of its aggregate is waiting.
    const blocked = new Set<string>();
    const batch: StoredRecord[] = [];
    for (const r of pending) {
      const key = `${r.event.aggregateType}:${r.event.aggregateId}`;
      if (blocked.has(key)) continue;
      if (r.claimed || r.nextAttemptAt > now) {
        blocked.add(key);
        continue;
      }
      if (batch.length < limit) batch.push(r);
    }
    for (const r of batch) r.claimed = true;
    return Promise.resolve(batch.map((r) => ({ event: r.event, attempts: r.attempts })));
  }

  markPublished(eventId: string, at: Date): Promise<void> {
    const r = this.find(eventId);
    r.publishedAt = at;
    r.claimed = false;
    return Promise.resolve();
  }

  markFailed(eventId: string, error: string, nextAttemptAt: Date): Promise<void> {
    const r = this.find(eventId);
    r.attempts += 1;
    r.lastError = error;
    r.nextAttemptAt = nextAttemptAt;
    r.claimed = false;
    return Promise.resolve();
  }

  moveToDeadLetter(eventId: string, error: string): Promise<void> {
    const r = this.find(eventId);
    r.attempts += 1;
    r.lastError = error;
    r.deadLettered = true;
    r.claimed = false;
    return Promise.resolve();
  }

  release(eventId: string): Promise<void> {
    this.find(eventId).claimed = false;
    return Promise.resolve();
  }

  private find(eventId: string): StoredRecord {
    const r = this.records.find((x) => x.event.id === eventId);
    if (!r) throw new Error(`outbox event ${eventId} not found`);
    return r;
  }
}
