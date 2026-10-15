import type { EventBus } from './bus.js';
import type { OutboxStore } from './outbox.js';

export interface RelayOptions {
  store: OutboxStore;
  bus: EventBus;
  batchSize?: number;
  /** Attempts (including the first) before an event is dead-lettered. */
  maxAttempts?: number;
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export interface RelayTickResult {
  published: number;
  failed: number;
  deadLettered: number;
  deferred: number;
}

export const exponentialBackoff =
  (baseMs = 1000, capMs = 5 * 60_000) =>
  (attempt: number): number =>
    Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Outbox relay (§5.1 step 2): at-least-once delivery, retry with backoff, dead-letter, per-aggregate order. */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(private readonly options: RelayOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.backoffMs = options.backoffMs ?? exponentialBackoff();
    this.now = options.now ?? (() => new Date());
  }

  async tick(): Promise<RelayTickResult> {
    const { store, bus } = this.options;
    const result: RelayTickResult = { published: 0, failed: 0, deadLettered: 0, deferred: 0 };
    const blockedAggregates = new Set<string>();
    const batch = await store.claimBatch(this.batchSize, this.now());

    for (const record of batch) {
      const { event } = record;
      const aggregateKey = `${event.aggregateType}:${event.aggregateId}`;
      if (blockedAggregates.has(aggregateKey)) {
        await store.release(event.id);
        result.deferred += 1;
        continue;
      }
      try {
        await bus.dispatch(event);
        await store.markPublished(event.id, this.now());
        result.published += 1;
      } catch (error) {
        blockedAggregates.add(aggregateKey);
        const attempt = record.attempts + 1;
        if (attempt >= this.maxAttempts) {
          await store.moveToDeadLetter(event.id, errorMessage(error));
          result.deadLettered += 1;
        } else {
          const next = new Date(this.now().getTime() + this.backoffMs(attempt));
          await store.markFailed(event.id, errorMessage(error), next);
          result.failed += 1;
        }
      }
    }
    return result;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .catch((error: unknown) => this.options.onError?.(error))
        .finally(() => {
          this.running = undefined;
        });
    }, intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
