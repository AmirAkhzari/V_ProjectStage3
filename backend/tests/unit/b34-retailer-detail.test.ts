import { describe, expect, it } from 'vitest';
import { readRetailerId } from '../../src/modules/customers/application/getRetailer.js';

const ID = '01000000-0000-4000-8000-000000000001';

describe('B34 retailer id', () => {
  it('accepts a canonical uuid and folds it to lower case', () => {
    expect(readRetailerId(ID)).toBe(ID);
    expect(readRetailerId(ID.toUpperCase())).toBe(ID);
  });

  it('returns null for anything that cannot be a row id', () => {
    for (const value of [
      '',
      'abc',
      'not-a-uuid',
      '01000000000040008000000000000001',
      '01000000-0000-4000-8000-00000000000',
      '01000000-0000-4000-8000-0000000000000',
      '01000000-0000-4000-8000-00000000000g',
    ]) {
      expect(readRetailerId(value), value).toBeNull();
    }
    expect(readRetailerId(undefined)).toBeNull();
    expect(readRetailerId(1)).toBeNull();
  });
});
