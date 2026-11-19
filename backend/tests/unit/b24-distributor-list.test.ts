import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/http/errors.js';
import {
  DISTRIBUTORS_LIST_MAX,
  encodeDistributorCursor,
  readAllFlag,
  readDistributorCursor,
  readDistributorListQuery,
  readListLimit,
} from '../../src/modules/tenancy/application/listDistributors.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : undefined;
  }
  return undefined;
}

describe('B24 readAllFlag', () => {
  it('defaults to the caller tenant when the parameter is absent', () => {
    expect(readAllFlag(undefined)).toBe(false);
  });

  it('accepts only the exact contract value 1', () => {
    expect(readAllFlag('1')).toBe(true);
  });

  it('rejects any other value instead of guessing at a list', () => {
    for (const value of ['0', 'true', '', ' 1', '1 ', '01', ['1', '1'], ['0']]) {
      expect(
        codeOf(() => readAllFlag(value)),
        JSON.stringify(value),
      ).toBe('VALIDATION_FAILED');
    }
  });
});

describe('B24 readListLimit', () => {
  it('defaults to one full page and accepts the closed window', () => {
    expect(readListLimit(undefined)).toBe(DISTRIBUTORS_LIST_MAX);
    expect(readListLimit('1')).toBe(1);
    expect(readListLimit('500')).toBe(500);
  });

  it('rejects anything that is not a canonical 1..500 page size', () => {
    for (const value of ['0', '501', '0001', '01', '1.5', 'abc', '', ['1'], 1]) {
      expect(
        codeOf(() => readListLimit(value)),
        JSON.stringify(value),
      ).toBe('VALIDATION_FAILED');
    }
  });
});

describe('B24 distributor cursor', () => {
  it('round-trips a name containing separators and non-ASCII text', () => {
    const name = 'فروشگاه \u0001 / a|b';
    const id = '02000000-0000-4000-8000-000000000001';
    expect(readDistributorCursor(encodeDistributorCursor(name, id))).toEqual({ name, id });
    expect(readDistributorCursor(undefined)).toBeNull();
  });

  it('refuses cursors it did not issue', () => {
    const malformed = [
      '',
      '*',
      'not-a-cursor',
      encodeDistributorCursor('name', 'not-a-uuid'),
      Buffer.from('missing-separator').toString('base64url'),
      Buffer.from('name\u0000extra\u0000parts').toString('base64url'),
      Buffer.from('\u000002000000-0000-4000-8000-000000000001').toString('base64url'),
    ];
    for (const value of malformed) {
      expect(
        codeOf(() => readDistributorCursor(value)),
        value,
      ).toBe('VALIDATION_FAILED');
    }
  });
});

describe('B24 readDistributorListQuery', () => {
  it('reads all, limit and after from the query string', () => {
    const after = encodeDistributorCursor('A', '02000000-0000-4000-8000-000000000001');
    expect(readDistributorListQuery({ all: '1', limit: '2', after })).toEqual({
      all: true,
      limit: 2,
      after: { name: 'A', id: '02000000-0000-4000-8000-000000000001' },
    });
    expect(readDistributorListQuery({})).toEqual({
      all: false,
      limit: DISTRIBUTORS_LIST_MAX,
      after: null,
    });
    expect(readDistributorListQuery(undefined)).toEqual({
      all: false,
      limit: DISTRIBUTORS_LIST_MAX,
      after: null,
    });
  });

  it('keeps the flag and the page window strict', () => {
    expect(codeOf(() => readDistributorListQuery({ all: '0' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => readDistributorListQuery({ limit: '999' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => readDistributorListQuery({ after: '2' }))).toBe('VALIDATION_FAILED');
  });
});
