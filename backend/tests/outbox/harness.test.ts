import { describe, expect, it } from 'vitest';
import { InProcessEventBus } from '../../src/platform/events/bus.js';
import type { EventEnvelope } from '../../src/platform/events/envelope.js';
import { InMemoryInboxStore } from '../../src/platform/events/inbox.js';
import { InMemoryOutboxStore } from '../../src/platform/events/outbox.js';
import { OutboxRelay } from '../../src/platform/events/relay.js';

/**
 * In-memory outbox harness (P0-E5 / F-7). Postgres commit/rollback is in `pg.harness.test.ts`.
 */
describe('outbox harness skeleton', () => {
  it('rollback path: no outbox row means no dispatch', async () => {
    const store = new InMemoryOutboxStore();
    const bus = new InProcessEventBus(new InMemoryInboxStore());
    let handled = 0;
    bus.subscribe('x.y', 'h', async () => {
      handled += 1;
    });
    await new OutboxRelay({ store, bus, now: () => new Date() }).tick();
    expect(handled).toBe(0);
    expect(store.snapshot()).toHaveLength(0);
  });

  it('duplicate delivery of the same event_id is applied once', async () => {
    const inbox = new InMemoryInboxStore();
    const bus = new InProcessEventBus(inbox);
    let handled = 0;
    bus.subscribe('x.y', 'h', async () => {
      handled += 1;
    });
    const event: EventEnvelope = {
      id: 'evt-1',
      type: 'x.y',
      version: 1,
      aggregateType: 'x',
      aggregateId: '1',
      distributorId: null,
      occurredAt: new Date(),
      payload: {},
    };
    await bus.dispatch(event);
    await bus.dispatch(event);
    expect(handled).toBe(1);
  });
});
