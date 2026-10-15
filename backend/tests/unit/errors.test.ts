import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ERROR_CODES,
  clientErrorEnvelope,
  errorEnvelope,
} from '../../src/platform/http/errors.js';

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
    expect(PLATFORM_ERROR_CODES).toContain('SERVICE_UNAVAILABLE');
  });

  it('maps 404/405 to NOT_FOUND and other 4xx to VALIDATION_FAILED, never INTERNAL', () => {
    expect(clientErrorEnvelope(404, 'missing')).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    expect(clientErrorEnvelope(405, 'Method Not Allowed')).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    expect(clientErrorEnvelope(413, 'too big')).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Payload too large',
        details: { statusCode: 413 },
      },
    });
    expect(clientErrorEnvelope(415, 'Unsupported Media Type')).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'Request could not be processed' },
    });
    for (let status = 400; status < 500; status += 1) {
      expect(clientErrorEnvelope(status, 'x').error.code).not.toBe('INTERNAL');
    }
  });
});
