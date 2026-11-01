import { describe, expect, it } from 'vitest';
import { DegradedRateLimiter, halfLimitPerInstance } from './degradedLimiter.js';

describe('SESS-06 degraded rate limit', () => {
  it('half of the normal limit per instance, then 429', () => {
    expect(halfLimitPerInstance(50, 2)).toBe(12);
    const limiter = new DegradedRateLimiter(2, 60_000, () => 1);
    expect(limiter.take('ip')).toBe('ok');
    expect(limiter.take('ip')).toBe('ok');
    expect(limiter.take('ip')).toBe('limited');
  });
});
