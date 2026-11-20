import { describe, expect, it } from 'vitest';
import {
  parseRetailerPrimaryDistributorBody,
  readDistributorId,
} from '../../src/modules/customers/application/setRetailerPrimaryDistributor.js';

const DIST = '02000000-0000-4000-8000-000000000001';

describe('B36 primary distributor body', () => {
  it('accepts exactly { primaryDistributorId: <uuid> } and folds it to lower case', () => {
    expect(parseRetailerPrimaryDistributorBody({ primaryDistributorId: DIST })).toBe(DIST);
    expect(parseRetailerPrimaryDistributorBody({ primaryDistributorId: DIST.toUpperCase() })).toBe(
      DIST,
    );
  });

  it('refuses a detached or extended body instead of guessing', () => {
    for (const body of [
      {},
      { primaryDistributorId: null },
      { primaryDistributorId: '' },
      { primaryDistributorId: 'not-a-uuid' },
      { primaryDistributorId: 1 },
      { primaryDistributorId: DIST, extra: 1 },
      { primary_distributor_id: DIST },
      // The platform hook rejects a caller-supplied `distributorId`, so it is never accepted here.
      { distributorId: DIST },
      [DIST],
      DIST,
      null,
      undefined,
    ]) {
      expect(() => parseRetailerPrimaryDistributorBody(body), JSON.stringify(body)).toThrow();
    }
  });
});

describe('B36 distributor id', () => {
  it('returns null for anything that cannot be a distributor id', () => {
    for (const value of ['', 'abc', '02000000000040008000000000000001', null, 1]) {
      expect(readDistributorId(value), String(value)).toBeNull();
    }
  });
});
