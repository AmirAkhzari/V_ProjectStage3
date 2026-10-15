import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/http/errors.js';
import { parseScopeDistributorHeader } from '../../src/platform/http/scope.js';

describe('parseScopeDistributorHeader', () => {
  it('returns undefined when the header is absent', () => {
    expect(parseScopeDistributorHeader(undefined)).toBeUndefined();
    expect(parseScopeDistributorHeader('')).toBeUndefined();
  });

  it('accepts a UUID and lowercases it', () => {
    expect(parseScopeDistributorHeader('11111111-1111-1111-1111-111111111111')).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('rejects a malformed X-Scope-Distributor', () => {
    expect(() => parseScopeDistributorHeader('not-a-uuid')).toThrow(AppError);
    expect(() => parseScopeDistributorHeader(['11111111-1111-1111-1111-111111111111'])).toThrow(
      AppError,
    );
  });
});
