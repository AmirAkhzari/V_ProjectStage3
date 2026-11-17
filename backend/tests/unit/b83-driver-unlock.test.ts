import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import {
  clearDriverLockout,
  ipFailKey,
  limiterKeyPart,
  passwordChangeKey,
  reserveDriverUnlock,
  tarpitKey,
  uipIndexKey,
  unlockDriverKey,
  unlockStaffKey,
  userFailKey,
  userIpFailKeyHashed,
  userIpLockKeyHashed,
  userLockKey,
} from '../../src/modules/identity/application/loginLimiter.js';
import {
  parseUnlockReason,
  readIdempotencyKey,
} from '../../src/modules/identity/application/unlockDriver.js';
import { AppError } from '../../src/platform/http/errors.js';

const USER = 'drv-aaaaaa';

class LockRedis {
  readonly sets = new Map<string, Set<string>>();
  readonly deleted: string[] = [];
  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }
  del = (...keys: string[]): Promise<number> => Promise.resolve(this.deleted.push(...keys));
  ttl = (): Promise<number> => Promise.resolve(-2);
}

class CounterRedis {
  readonly counts = new Map<string, number>();
  eval = (_lua: string, _n: number, key: string): Promise<number> => {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return Promise.resolve(next);
  };
  ttl = (): Promise<number> => Promise.resolve(3600);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-app-error';
  }
  return undefined;
}

describe('B83 driver unlock', () => {
  it('B83-01: clears username+IP and username keys/locks, never per-IP/tarpit/C11', async () => {
    const redis = new LockRedis();
    const userHash = limiterKeyPart(USER);
    redis.sets.set(uipIndexKey(USER), new Set(['iphash1', 'iphash2']));
    await clearDriverLockout(redis as unknown as Redis, USER);
    expect(new Set(redis.deleted)).toEqual(
      new Set([
        userFailKey(USER),
        userLockKey(USER),
        userIpFailKeyHashed(userHash, 'iphash1'),
        userIpLockKeyHashed(userHash, 'iphash1'),
        userIpFailKeyHashed(userHash, 'iphash2'),
        userIpLockKeyHashed(userHash, 'iphash2'),
        uipIndexKey(USER),
      ]),
    );
    for (const untouched of [ipFailKey('203.0.113.9'), tarpitKey('203.0.113.9')]) {
      expect(redis.deleted).not.toContain(untouched);
    }
    expect(redis.deleted).not.toContain(passwordChangeKey('account-id'));
  });

  it('B83-06: reason trims / maps missing, short, long; Idempotency-Key 16..128', () => {
    expect(parseUnlockReason({ reason: '   lockout typo reset  ' })).toBe('lockout typo reset');
    expect(parseUnlockReason({ reason: 'a'.repeat(500) })).toHaveLength(500);
    expect(codeOf(() => parseUnlockReason({}))).toBe('REASON_REQUIRED');
    expect(codeOf(() => parseUnlockReason({ reason: 'ab' }))).toBe('REASON_REQUIRED');
    expect(codeOf(() => parseUnlockReason({ reason: 'a'.repeat(501) }))).toBe('REASON_TOO_LONG');
    expect(codeOf(() => parseUnlockReason({ reason: 'okay', extra: 1 }))).toBe('VALIDATION_FAILED');
    expect(readIdempotencyKey('a'.repeat(16))).toHaveLength(16);
    expect(codeOf(() => readIdempotencyKey(undefined))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf(() => readIdempotencyKey('short'))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf(() => readIdempotencyKey('a'.repeat(129)))).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('LIM-B83-01: 10/h per staff, 3/h per driver, every attempt counts', async () => {
    const redis = new CounterRedis();
    const fake = redis as unknown as Redis;
    for (let n = 1; n <= 10; n += 1) {
      await expect(reserveDriverUnlock(fake, 'staff-1', `drv-${n}`)).resolves.toMatchObject({
        allowed: true,
      });
    }
    expect(await reserveDriverUnlock(fake, 'staff-1', 'drv-11')).toEqual({
      allowed: false,
      retryAfter: 3600,
    });
    expect(unlockStaffKey('staff-1')).toMatch(/^unlock:staff:/);
    expect(unlockDriverKey('drv')).toMatch(/^unlock:driver:/);
    const other = new CounterRedis();
    const otherFake = other as unknown as Redis;
    for (let n = 1; n <= 3; n += 1) {
      await expect(reserveDriverUnlock(otherFake, 'staff-2', 'drv-x')).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(reserveDriverUnlock(otherFake, 'staff-2', 'drv-x')).resolves.toEqual({
      allowed: false,
      retryAfter: 3600,
    });
  });
});
