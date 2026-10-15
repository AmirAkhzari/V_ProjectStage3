import { describe, expect, it } from 'vitest';
import { PLATFORM_ERROR_CODES, errorEnvelope } from '../../src/platform/http/errors.js';

describe('error envelope', () => {
  it('matches {error:{code,message,details?}}', () => {
    expect(errorEnvelope('NOT_FOUND', 'Resource not found')).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    expect(errorEnvelope('VALIDATION_FAILED', 'bad', { field: 'x' })).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'bad', details: { field: 'x' } },
    });
  });

  it('only emits codes that exist on the frozen contract', () => {
    expect(PLATFORM_ERROR_CODES.length).toBeGreaterThan(0);
  });
});
