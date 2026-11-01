import { describe, expect, it } from 'vitest';
import { SESSION_TTL, configureSessionTtl, sessionTtlMs } from './sessionTtl.js';

describe('session TTL config', () => {
  it('defaults match decided shopkeeper/staff values; driver 10h is the default', () => {
    configureSessionTtl({});
    expect(sessionTtlMs('shopkeeper')).toEqual(SESSION_TTL.shopkeeper);
    expect(sessionTtlMs('staff')).toEqual(SESSION_TTL.staff);
    expect(sessionTtlMs('driver').absoluteMs).toBe(10 * 60 * 60 * 1000);
    configureSessionTtl({ driverAbsoluteMs: 8 * 60 * 60 * 1000 });
    expect(sessionTtlMs('driver').absoluteMs).toBe(8 * 60 * 60 * 1000);
    configureSessionTtl({});
  });
});
