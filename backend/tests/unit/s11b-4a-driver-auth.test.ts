import { describe, expect, it } from 'vitest';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import {
  DRIVER_MAX_SESSIONS,
  DUMMY_ARGON2ID_HASH,
  LOGIN_IP_FAIL_LIMIT,
  hashUsernameForAudit,
  nextBackoffSeconds,
  normalizeUsername,
  passwordOverLongBytes,
  tarpitDelaySeconds,
  usernameOverLong,
} from '../../src/modules/identity/domain/loginPolicy.js';
import { isRetryableLockError } from '../../src/modules/identity/infra/session/lockOrder.js';

describe('S11b-4a login policy / F13-1', () => {
  it('normalises usernames: trim, NFKC, lower; does not truncate', () => {
    expect(normalizeUsername('  AbC  ')).toBe('abc');
    expect(normalizeUsername('ﬁle')).toBe('file');
    expect(normalizeUsername('x'.repeat(80))).toHaveLength(80);
    expect(usernameOverLong(normalizeUsername('x'.repeat(65)))).toBe(true);
    expect(usernameOverLong(normalizeUsername('x'.repeat(64)))).toBe(false);
  });

  it('V11-O2-01 / R12-8: over-long passwords are rejected, not truncated', () => {
    expect(passwordOverLongBytes('é'.repeat(80))).toBe(true);
    expect(passwordOverLongBytes('a'.repeat(128))).toBe(false);
  });

  it('9-10: dummy argon2id verify runs and rejects', async () => {
    const hasher = new Argon2idPasswordHasher();
    expect(DUMMY_ARGON2ID_HASH.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(DUMMY_ARGON2ID_HASH, 'any-password')).toBe(false);
  });

  it('F13-1: 55P03 and 40P01 are retryable lock errors', () => {
    expect(isRetryableLockError({ code: '55P03', message: 'lock timeout' })).toBe(true);
    expect(isRetryableLockError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
    expect(isRetryableLockError({ code: '23505', message: 'unique' })).toBe(false);
  });

  it('LIM-LG-02/03/04 and AUTH-RT-05 defaults', () => {
    expect(DRIVER_MAX_SESSIONS).toBe(2);
    expect(LOGIN_IP_FAIL_LIMIT).toBe(50);
    expect(nextBackoffSeconds(4)).toBeNull();
    expect(nextBackoffSeconds(5)).toBe(60);
    expect(nextBackoffSeconds(10)).toBe(5 * 60);
    expect(nextBackoffSeconds(15)).toBe(15 * 60);
    expect(nextBackoffSeconds(20)).toBe(60 * 60);
    expect(tarpitDelaySeconds(20)).toBe(0);
    expect(tarpitDelaySeconds(21)).toBe(1);
    expect(tarpitDelaySeconds(40)).toBe(10);
    expect(hashUsernameForAudit('ali')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUsernameForAudit('ali')).not.toContain('ali');
  });
});
