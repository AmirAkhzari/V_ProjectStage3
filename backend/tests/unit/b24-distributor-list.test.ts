import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/http/errors.js';
import { readAllFlag } from '../../src/modules/tenancy/application/listDistributors.js';

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
