import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/http/errors.js';
import {
  presentedRefreshToken,
  refreshSchemaValidators,
  requireLogoutToken,
} from '../../src/modules/identity/application/refreshAuth.js';

const base = {
  accessToken: 'a.b.c',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  absoluteExpiresAt: '2026-04-01T00:00:00.000Z',
  tokenType: 'Bearer',
  user: { id: '11111111-1111-4111-8111-111111111111', phone: '+989121234567', isNewAccount: false },
};

describe('S11b-5b refresh shape', () => {
  it('Ajv 2020 accepts a paired body and rejects a one-sided body', () => {
    const { shopkeeper } = refreshSchemaValidators();
    expect(shopkeeper(base)).toBe(true);
    expect(shopkeeper({ ...base, refreshToken: 'x'.repeat(43) })).toBe(false);
    expect(
      shopkeeper({
        ...base,
        refreshToken: 'x'.repeat(43),
        refreshExpiresAt: '2026-01-31T00:00:00.000Z',
      }),
    ).toBe(true);
    const grace = { ...base };
    expect(grace).not.toHaveProperty('refreshToken');
    expect(shopkeeper(grace)).toBe(true);
  });

  it('A3 parser rejects short tokens; A4 422 does not echo them', () => {
    expect(presentedRefreshToken({ refreshToken: 'short' })).toBeUndefined();
    expect(presentedRefreshToken({ refreshToken: 'a'.repeat(43), extra: 1 })).toBeUndefined();
    try {
      requireLogoutToken({ refreshToken: 'short' });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(422);
      expect(JSON.stringify(error)).not.toContain('short');
    }
  });
});
