import { describe, expect, it } from 'vitest';
import { parseRetailerStatusBody } from '../../src/modules/customers/application/setRetailerStatus.js';

describe('B35 retailer status body', () => {
  it('accepts exactly the two states the column holds', () => {
    expect(parseRetailerStatusBody({ status: 'active' })).toBe('active');
    expect(parseRetailerStatusBody({ status: 'blocked' })).toBe('blocked');
  });

  it('refuses anything else instead of ignoring it', () => {
    for (const body of [
      {},
      { status: 'deleted' },
      { status: 'ACTIVE' },
      { status: '' },
      { status: 1 },
      { status: null },
      { status: 'active', plan: 'gold' },
      { status: 'active', status2: 'blocked' },
      ['active'],
      'active',
      null,
      undefined,
    ]) {
      expect(() => parseRetailerStatusBody(body), JSON.stringify(body)).toThrow();
    }
  });
});
