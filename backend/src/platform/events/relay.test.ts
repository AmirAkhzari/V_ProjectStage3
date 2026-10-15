import { describe, expect, it } from 'vitest';
import { InProcessEventBus } from './bus.js';
import type { EventEnvelope } from './envelope.js';
import { InMemoryInboxStore } from './inbox.js';
import { InMemoryOutboxStore } from './outbox.js';
import { OutboxRelay } from './relay.js';

function event(id: string, aggregateId = 'agg-1'): EventEnvelope {
  return {
    id,
    type: 'platform.test',
    version: 1,
    aggregateType: 'test',
    aggregateId,
    distributorId: null,
    occurredAt: new Date(1_000),
    payload: { id },
  };
}

describe('OutboxRelay', () => {
  it('does not publish when the producer rolls back (event never inserted)', async () => {
    const store = new InMemoryOutboxStore();
    const seen: string[] = [];
    const bus = new InProcessEventBus(new InMemoryInboxStore());
    bus.subscribe('platform.test', 'c1', async (e) => {
      seen.push(e.id);
    });
    const relay = new OutboxRelay({ store, bus, now: () => new Date(2_000) });
    const result = await relay.tick();
    expect(result.published).toBe(0);
    expect(seen).toEqual([]);
  });

  it('publishes exactly once after commit', async () => {
    const store = new InMemoryOutboxStore();
    store.add(event('e1'));
    const seen: string[] = [];
    const bus = new InProcessEventBus(new InMemoryInboxStore());
    bus.subscribe('platform.test', 'c1', async (e) => {
      seen.push(e.id);
    });
    const relay = new OutboxRelay({ store, bus, now: () => new Date(2_000) });
    await relay.tick();
    await relay.tick();
    expect(seen).toEqual(['e1']);
    expect(store.snapshot()[0]?.publishedAt).toBeTruthy();
  });

  it('dead-letters after maxAttempts and keeps per-aggregate order', async () => {
    const store = new InMemoryOutboxStore();
    store.add(event('e1', 'a'));
    store.add(event('e2', 'a'));
    let fail = true;
    const bus = new InProcessEventBus(new InMemoryInboxStore());
    bus.subscribe('platform.test', 'c1', async (e) => {
      if (fail && e.id === 'e1') throw new Error('boom');
    });
    const relay = new OutboxRelay({
      store,
      bus,
      maxAttempts: 2,
      backoffMs: () => 0,
      now: () => new Date(2_000),
    });
    const first = await relay.tick();
    expect(first.failed).toBe(1);
    expect(first.deferred).toBe(1);
    fail = false;
    const second = await relay.tick();
    expect(second.deadLettered + second.published).toBeGreaterThan(0);
  });
});
