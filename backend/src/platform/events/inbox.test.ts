import { describe, expect, it } from 'vitest';
import { InMemoryInboxStore } from './inbox.js';

describe('InMemoryInboxStore', () => {
  it('runs an effect only once for the same consumer and event', async () => {
    const inbox = new InMemoryInboxStore();
    let count = 0;
    const first = await inbox.runOnce('c', 'e', async () => {
      count += 1;
    });
    const second = await inbox.runOnce('c', 'e', async () => {
      count += 1;
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(count).toBe(1);
  });
});
