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
  normalizeUserAgent,
  parseUnlockReason,
  readIdempotencyKey,
} from '../../src/modules/identity/application/unlockDriver.js';
import { AppError } from '../../src/platform/http/errors.js';

const USER = 'drv-aaaaaa';
const HASH = limiterKeyPart(USER);

class LockRedis {
  readonly sets = new Map<string, Set<string>>();
  readonly deleted: string[] = [];
  smembers = (key: string) => Promise.resolve([...(this.sets.get(key) ?? [])]);
  del = (...keys: string[]) => Promise.resolve(this.deleted.push(...keys));
  ttl = () => Promise.resolve(-2);
}

class CounterRedis {
  readonly counts = new Map<string, number>();
  eval = (_lua: string, _n: number, key: string) => {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    return Promise.resolve(this.counts.get(key)!);
  };
  ttl = () => Promise.resolve(3600);
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
    redis.sets.set(uipIndexKey(USER), new Set(['iphash1', 'iphash2']));
    await clearDriverLockout(redis as unknown as Redis, USER);
    const expected = [
      userFailKey(USER),
      userLockKey(USER),
      uipIndexKey(USER),
      userIpFailKeyHashed(HASH, 'iphash1'),
      userIpLockKeyHashed(HASH, 'iphash1'),
      userIpFailKeyHashed(HASH, 'iphash2'),
      userIpLockKeyHashed(HASH, 'iphash2'),
    ];
    expect(new Set(redis.deleted)).toEqual(new Set(expected));
    const untouched = [
      ipFailKey('203.0.113.9'),
      tarpitKey('203.0.113.9'),
      passwordChangeKey('acc'),
    ];
    for (const key of untouched) expect(redis.deleted).not.toContain(key);
  });

  it('B83-06: reason trims / maps missing, short, long; Idempotency-Key 16..128', () => {
    expect(parseUnlockReason({ reason: '   lockout typo reset  ' })).toBe('lockout typo reset');
    expect(parseUnlockReason({ reason: 'a'.repeat(500) })).toHaveLength(500);
    const bad: [unknown, string][] = [
      [{}, 'REASON_REQUIRED'],
      [{ reason: 'ab' }, 'REASON_REQUIRED'],
      [{ reason: 'a'.repeat(501) }, 'REASON_TOO_LONG'],
      [{ reason: 'okay', extra: 1 }, 'VALIDATION_FAILED'],
    ];
    for (const [body, code] of bad) expect(codeOf(() => parseUnlockReason(body))).toBe(code);
    let long: unknown;
    try {
      parseUnlockReason({ reason: 'a'.repeat(501) });
    } catch (error) {
      long = error;
    }
    expect(long).toMatchObject({ details: { max: 500 } });
    expect(readIdempotencyKey('a'.repeat(16))).toHaveLength(16);
    for (const key of [undefined, 'short', 'a'.repeat(129)]) {
      expect(codeOf(() => readIdempotencyKey(key))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
  });

  it('LIM-B83-01: 10/h per staff, 3/h per driver, every attempt counts', async () => {
    const redis = new CounterRedis() as unknown as Redis;
    for (let n = 1; n <= 10; n += 1)
      expect(await reserveDriverUnlock(redis, 'staff-1', `drv-${n}`)).toEqual({
        allowed: true,
        driverCount: 1,
      });
    const staffBlocked = await reserveDriverUnlock(redis, 'staff-1', 'drv-11');
    expect(staffBlocked.allowed).toBe(false);
    if (!staffBlocked.allowed) expect(staffBlocked.retryAfter).toBeGreaterThan(0);
    expect(unlockStaffKey('staff-1')).toMatch(/^unlock:staff:/);
    expect(unlockDriverKey('drv')).toMatch(/^unlock:driver:/);
    const other = new CounterRedis() as unknown as Redis;
    for (let n = 1; n <= 3; n += 1)
      expect(await reserveDriverUnlock(other, 'staff-2', 'drv-x')).toEqual({
        allowed: true,
        driverCount: n,
      });
    const driverBlocked = await reserveDriverUnlock(other, 'staff-2', 'drv-x');
    expect(driverBlocked.allowed).toBe(false);
    if (!driverBlocked.allowed) expect(driverBlocked.retryAfter).toBeGreaterThan(0);
  });

  it('P7-5: user agent is stripped, trimmed and capped at 256 code points', () => {
    expect(normalizeUserAgent('ok\r\nUA\t')).toBe('okUA');
    for (const value of [undefined, '', '  ', '\u0000\u001f\u007f\u009f']) {
      expect(normalizeUserAgent(value)).toBeNull();
    }
    expect(normalizeUserAgent('a'.repeat(300))).toHaveLength(256);
    const emoji = normalizeUserAgent('🦊'.repeat(300))!;
    expect(Array.from(emoji)).toHaveLength(256);
    expect(Array.from(emoji).at(-1)).toBe('🦊');
  });
});
