import { describe, expect, it } from 'vitest';
import {
  RETAILERS_LIST_MAX,
  encodeRetailerCursor,
  readRetailerCursor,
  readRetailerListQuery,
} from '../../src/modules/customers/application/listRetailers.js';

const ID = '01000000-0000-4000-8000-000000000001';
const WHEN = '2026-11-19T10:00:00.000Z';

describe('B33 retailer list query', () => {
  it('defaults to the maximum page when no limit is given', () => {
    expect(readRetailerListQuery({})).toEqual({ limit: RETAILERS_LIST_MAX, after: null });
  });

  it('accepts a canonical page size', () => {
    expect(readRetailerListQuery({ limit: '20' })).toEqual({ limit: 20, after: null });
    expect(readRetailerListQuery({ limit: '500' })).toEqual({
      limit: RETAILERS_LIST_MAX,
      after: null,
    });
  });

  it('rejects a non-canonical page size', () => {
    for (const limit of ['0', '01', '1.5', '501', 'abc', '', ' 20']) {
      expect(() => readRetailerListQuery({ limit }), limit).toThrow();
    }
    expect(() => readRetailerListQuery({ limit: 20 })).toThrow();
  });

  it('round-trips the opaque cursor', () => {
    const cursor = encodeRetailerCursor(WHEN, ID);
    expect(readRetailerListQuery({ after: cursor }).after).toEqual({
      createdAt: WHEN,
      id: ID,
    });
  });

  it('refuses a cursor the client built itself instead of guessing', () => {
    const good = encodeRetailerCursor(WHEN, ID);
    const cases = [
      `${good}=`,
      'not-base64!',
      Buffer.from(`2026-11-19T10:00:00.000Z\u0000${ID}\u0000extra`).toString('base64url'),
      Buffer.from(`2026-11-19 10:00:00+00:00\u0000${ID}`).toString('base64url'),
      Buffer.from(`2026-11-19T10:00:00.000Z\u0000not-a-uuid`).toString('base64url'),
      Buffer.from(`\u0000${ID}`).toString('base64url'),
    ];
    for (const after of cases) {
      expect(() => readRetailerCursor(after), after).toThrow();
    }
  });

  it('treats a non-string cursor as malformed', () => {
    expect(() => readRetailerCursor(['x'])).toThrow();
    expect(() => readRetailerCursor(1)).toThrow();
  });
});
