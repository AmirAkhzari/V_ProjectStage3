import { describe, expect, it } from 'vitest';
import {
  parseDefaultAddressBody,
  readAddressId,
} from '../../src/modules/customers/domain/address.js';

const ADDRESS_ID = '03000000-0000-4000-8000-00000000000a';
const UPPER_ID = '03000000-0000-4000-8000-00000000000B';

describe('A11/A13 address id', () => {
  it('normalises a real uuid and refuses anything that cannot be a row id', () => {
    expect(readAddressId(ADDRESS_ID)).toBe(ADDRESS_ID);
    expect(readAddressId(UPPER_ID)).toBe(UPPER_ID.toLowerCase());
    for (const value of ['', 'default', 'not-a-uuid', `${ADDRESS_ID}x`, 42, null, undefined, {}]) {
      expect(readAddressId(value), String(value)).toBeNull();
    }
  });
});

describe('A12 default address body', () => {
  it('accepts exactly { addressId } and normalises the case', () => {
    expect(parseDefaultAddressBody({ addressId: ADDRESS_ID })).toBe(ADDRESS_ID);
    expect(parseDefaultAddressBody({ addressId: UPPER_ID })).toBe(UPPER_ID.toLowerCase());
  });

  it('refuses extra keys, a missing or malformed id and non-object bodies', () => {
    for (const body of [
      {},
      { addressId: ADDRESS_ID, isDefault: true },
      { addressId: ADDRESS_ID, shopkeeperId: ADDRESS_ID },
      { id: ADDRESS_ID },
      { addressId: 'default' },
      { addressId: 42 },
      { addressId: ADDRESS_ID, extra: null },
      null,
      undefined,
      [ADDRESS_ID],
      'address',
    ]) {
      expect(() => parseDefaultAddressBody(body), JSON.stringify(body)).toThrow();
    }
  });
});
