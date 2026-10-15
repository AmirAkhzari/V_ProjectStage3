/**
 * Consumer-side idempotency (`platform.inbox_processed`, PK `(consumer, event_id)`).
 * `runOnce` must record the event and apply `effect` atomically; the Postgres implementation does
 * both in one transaction. Only the in-memory implementation exists until the table is authorized.
 */
export interface InboxStore {
  /** Returns `true` when `effect` ran, `false` when the event was already processed. */
  runOnce(consumer: string, eventId: string, effect: () => Promise<void>): Promise<boolean>;
}

export class InMemoryInboxStore implements InboxStore {
  private readonly processed = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();

  async runOnce(consumer: string, eventId: string, effect: () => Promise<void>): Promise<boolean> {
    const key = `${consumer}\u0000${eventId}`;
    const pending = this.inFlight.get(key);
    if (pending) {
      await pending.catch(() => {});
    }
    if (this.processed.has(key)) return false;

    const run = effect();
    this.inFlight.set(key, run);
    try {
      await run;
      this.processed.add(key);
      return true;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
