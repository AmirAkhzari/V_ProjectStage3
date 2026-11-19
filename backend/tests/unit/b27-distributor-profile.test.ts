import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/http/errors.js';
import {
  IDEMPOTENCY_KEY_MAX,
  IDEMPOTENCY_KEY_MIN,
  PROFILE_NAME_MAX,
  parseProfileUpdateBody,
  readOptionalIdempotencyKey,
} from '../../src/modules/tenancy/application/updateDistributorProfile.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : undefined;
  }
  return undefined;
}

describe('B27 parseProfileUpdateBody', () => {
  it('accepts a single name and trims surrounding whitespace', () => {
    expect(parseProfileUpdateBody({ name: '  پخش شمال  ' })).toEqual({ name: 'پخش شمال' });
    expect(parseProfileUpdateBody({ name: 'a'.repeat(PROFILE_NAME_MAX) })).toEqual({
      name: 'a'.repeat(PROFILE_NAME_MAX),
    });
  });

  it('rejects a non-object, an array and a missing name', () => {
    for (const body of [undefined, null, 'name', 5, [], [{ name: 'x' }], {}]) {
      expect(codeOf(() => parseProfileUpdateBody(body))).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects extra keys so a client cannot believe status or money changed', () => {
    for (const body of [
      { name: 'ok', status: 'inactive' },
      { name: 'ok', commission: 5 },
      { name: 'ok', distributorId: 'x' },
      { status: 'inactive' },
    ]) {
      expect(codeOf(() => parseProfileUpdateBody(body))).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects a non-string, an empty name, an over-long name and control characters', () => {
    for (const body of [
      { name: 5 },
      { name: null },
      { name: '   ' },
      { name: 'a'.repeat(PROFILE_NAME_MAX + 1) },
      { name: 'a\nb' },
      { name: 'a\tb' },
    ]) {
      expect(codeOf(() => parseProfileUpdateBody(body))).toBe('VALIDATION_FAILED');
    }
  });
});

describe('B27 readOptionalIdempotencyKey', () => {
  it('is optional and accepts the B83 window', () => {
    expect(readOptionalIdempotencyKey(undefined)).toBeUndefined();
    expect(readOptionalIdempotencyKey('k'.repeat(IDEMPOTENCY_KEY_MIN))).toBe(
      'k'.repeat(IDEMPOTENCY_KEY_MIN),
    );
    expect(readOptionalIdempotencyKey('k'.repeat(IDEMPOTENCY_KEY_MAX))).toBe(
      'k'.repeat(IDEMPOTENCY_KEY_MAX),
    );
  });

  it('rejects a repeated header, too short and too long values', () => {
    for (const value of [
      ['k'.repeat(20), 'k'.repeat(20)],
      'k'.repeat(IDEMPOTENCY_KEY_MIN - 1),
      'k'.repeat(IDEMPOTENCY_KEY_MAX + 1),
    ]) {
      expect(codeOf(() => readOptionalIdempotencyKey(value))).toBe('VALIDATION_FAILED');
    }
  });
});
