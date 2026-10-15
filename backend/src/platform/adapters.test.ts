import { describe, expect, it } from 'vitest';
import { assertAdapterAllowed } from './adapters.js';

describe('assertAdapterAllowed', () => {
  it('allows mock adapters outside production', () => {
    expect(() => assertAdapterAllowed('sms', 'mock', 'test')).not.toThrow();
    expect(() => assertAdapterAllowed('payment', 'mock', 'development')).not.toThrow();
  });

  it('hard-fails mock adapters in production', () => {
    expect(() => assertAdapterAllowed('sms', 'mock', 'production')).toThrow(/sms mock adapter/);
    expect(() => assertAdapterAllowed('payment', 'mock', 'production')).toThrow(
      /payment mock adapter/,
    );
    expect(() => assertAdapterAllowed('passwordHasher', 'mock', 'production')).toThrow(
      /passwordHasher mock adapter/,
    );
  });

  it('allows non-mock adapters in production', () => {
    expect(() => assertAdapterAllowed('sms', 'kavenegar', 'production')).not.toThrow();
  });
});
