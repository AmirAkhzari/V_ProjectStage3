import { describe, expect, it } from 'vitest';
import { readDistributorId } from '../../src/modules/tenancy/application/getAppDistributor.js';

const DISTRIBUTOR_ID = '01000000-0000-4000-8000-000000000001';
const UPPER_ID = '01000000-0000-4000-8000-00000000000B';

describe('A18 distributor id', () => {
  it('normalises a real uuid and refuses anything that cannot be a row id', () => {
    expect(readDistributorId(DISTRIBUTOR_ID)).toBe(DISTRIBUTOR_ID);
    expect(readDistributorId(UPPER_ID)).toBe(UPPER_ID.toLowerCase());
    expect(readDistributorId(` ${DISTRIBUTOR_ID} `)).toBe(DISTRIBUTOR_ID);
    for (const value of ['', 'd1', 'not-a-uuid', `${DISTRIBUTOR_ID}x`, 42, null, undefined, {}]) {
      expect(readDistributorId(value), String(value)).toBeNull();
    }
  });
});
