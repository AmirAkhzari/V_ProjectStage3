import type { EventEnvelope } from './envelope.js';
import type { InboxStore } from './inbox.js';

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventBus {
  subscribe(eventType: string, consumer: string, handler: EventHandler): void;
  /** Delivers to every subscriber; rejects if any handler fails so the relay can retry. */
  dispatch(event: EventEnvelope): Promise<void>;
}

interface Subscription {
  consumer: string;
  handler: EventHandler;
}

/** In-process bus with idempotent consumers (§5.1 step 3). */
export class InProcessEventBus implements EventBus {
  private readonly subscriptions = new Map<string, Subscription[]>();

  constructor(private readonly inbox: InboxStore) {}

  subscribe(eventType: string, consumer: string, handler: EventHandler): void {
    const list = this.subscriptions.get(eventType) ?? [];
    if (list.some((s) => s.consumer === consumer)) {
      throw new Error(`consumer "${consumer}" is already subscribed to "${eventType}"`);
    }
    list.push({ consumer, handler });
    this.subscriptions.set(eventType, list);
  }

  async dispatch(event: EventEnvelope): Promise<void> {
    const list = this.subscriptions.get(event.type) ?? [];
    const results = await Promise.allSettled(
      list.map((s) => this.inbox.runOnce(s.consumer, event.id, () => s.handler(event))),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.reason as unknown),
        `${failures.length} handler(s) failed for event ${event.type}#${event.id}`,
      );
    }
  }
}
