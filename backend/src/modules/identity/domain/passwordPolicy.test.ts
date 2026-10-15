import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBreachedPasswordList } from '../infra/crypto/breachedPasswords.js';
import {
  DRIVER_PASSWORD_CHANGE_PATH,
  PASSWORD_MAX_LENGTH,
  TEMP_PASSWORD_MIN_LENGTH,
  TEMP_PASSWORD_TTL_MS,
  assertDriverRouteAllowed,
  assertNewPassword,
  evaluateNewPassword,
  generateTempCredential,
  isDriverRouteAllowed,
  normalizePassword,
  PasswordPolicyError,
} from './passwordPolicy.js';

const list = loadBreachedPasswordList();

describe('password policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AUTH-PW-02: accepts 8–128 NFKC characters and rejects shorter or longer', () => {
    expect(evaluateNewPassword('abcdefgh', list.has.bind(list))).toEqual({
      ok: true,
      normalized: 'abcdefgh',
    });
    expect(evaluateNewPassword('a'.repeat(PASSWORD_MAX_LENGTH), list.has.bind(list)).ok).toBe(true);
    expect(evaluateNewPassword('short7', list.has.bind(list))).toEqual({
      ok: false,
      code: 'PASSWORD_TOO_SHORT',
    });
    expect(evaluateNewPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1), list.has.bind(list))).toEqual({
      ok: false,
      code: 'PASSWORD_TOO_LONG',
    });
    const compat = 'ﬁleword';
    expect(normalizePassword(compat)).toBe('fileword');
    expect(assertNewPassword(compat, () => false)).toBe('fileword');
  });

  it('AUTH-PW-02-OFF: returns PASSWORD_BREACHED from the offline list and never calls HIBP', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('egress to api.pwnedpasswords.com is forbidden');
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(list.version).toBe('2026-10-15.1');
    expect(list.has('password')).toBe(true);
    expect(evaluateNewPassword('password', list.has.bind(list))).toEqual({
      ok: false,
      code: 'PASSWORD_BREACHED',
    });
    expect(evaluateNewPassword('Password', list.has.bind(list)).ok).toBe(false);
    expect(() => assertNewPassword('123456', list.has.bind(list))).toThrow(PasswordPolicyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AUTH-PW-03: issues a ≥12 char CSPRNG temp password, 72h expiry, must_change_password', () => {
    const now = new Date('2026-10-15T00:00:00.000Z');
    const cred = generateTempCredential(now, list.has.bind(list));
    expect(cred.mustChangePassword).toBe(true);
    expect(cred.password.length).toBeGreaterThanOrEqual(TEMP_PASSWORD_MIN_LENGTH);
    expect(evaluateNewPassword(cred.password, list.has.bind(list)).ok).toBe(true);
    expect(cred.tempExpiresAt.getTime() - now.getTime()).toBe(TEMP_PASSWORD_TTL_MS);
  });

  it('AUTH-PW-04: while must_change_password only C11 is allowed', () => {
    expect(isDriverRouteAllowed(true, DRIVER_PASSWORD_CHANGE_PATH)).toBe(true);
    expect(isDriverRouteAllowed(true, '/v1/driver/auth/login')).toBe(false);
    expect(isDriverRouteAllowed(true, '/v1/driver/auth/refresh')).toBe(false);
    expect(isDriverRouteAllowed(false, '/v1/driver/auth/login')).toBe(true);
    expect(() => assertDriverRouteAllowed(true, '/v1/driver/orders')).toThrow(PasswordPolicyError);
    try {
      assertDriverRouteAllowed(true, '/v1/driver/orders');
    } catch (error) {
      expect(error).toBeInstanceOf(PasswordPolicyError);
      expect((error as PasswordPolicyError).code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect(() => assertDriverRouteAllowed(true, DRIVER_PASSWORD_CHANGE_PATH)).not.toThrow();
  });
});
