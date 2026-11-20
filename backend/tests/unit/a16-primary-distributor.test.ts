import { describe, expect, it } from 'vitest';
import {
  parsePrimaryDistributorBody,
  readPrimaryDistributorId,
} from '../../src/modules/customers/application/chooseMyPrimaryDistributor.js';

const DISTRIBUTOR_ID = '01000000-0000-4000-8000-000000000001';
const UPPER_ID = '01000000-0000-4000-8000-00000000000B';

describe('A16 distributor id', () => {
  it('normalises a real uuid and refuses anything that cannot be a row id', () => {
    expect(readPrimaryDistributorId(DISTRIBUTOR_ID)).toBe(DISTRIBUTOR_ID);
    expect(readPrimaryDistributorId(UPPER_ID)).toBe(UPPER_ID.toLowerCase());
    for (const value of ['', 'd1', 'not-a-uuid', `${DISTRIBUTOR_ID}x`, 42, null, undefined, {}]) {
      expect(readPrimaryDistributorId(value), String(value)).toBeNull();
    }
  });
});

describe('A16 primary distributor body', () => {
  it('accepts exactly { primaryDistributorId } and normalises the case', () => {
    expect(parsePrimaryDistributorBody({ primaryDistributorId: DISTRIBUTOR_ID })).toBe(
      DISTRIBUTOR_ID,
    );
    expect(parsePrimaryDistributorBody({ primaryDistributorId: UPPER_ID })).toBe(
      UPPER_ID.toLowerCase(),
    );
  });

  it('refuses the client-identity name, extra keys and a missing id', () => {
    for (const body of [
      {},
      // `distributorId` is the request's own scope; the platform hook also refuses it outright.
      { distributorId: DISTRIBUTOR_ID },
      { primaryDistributorId: DISTRIBUTOR_ID, distributorId: DISTRIBUTOR_ID },
      { primaryDistributorId: DISTRIBUTOR_ID, shopkeeperId: DISTRIBUTOR_ID },
      { primaryDistributorId: null },
      { primaryDistributorId: 'd1' },
      { primaryDistributorId: 42 },
      { id: DISTRIBUTOR_ID },
    ]) {
      expect(() => parsePrimaryDistributorBody(body), JSON.stringify(body)).toThrow();
    }
  });

  it('refuses non-object bodies', () => {
    for (const body of [null, undefined, [], [DISTRIBUTOR_ID], 'distributor', 7]) {
      expect(() => parsePrimaryDistributorBody(body), String(body)).toThrow();
    }
  });
});
