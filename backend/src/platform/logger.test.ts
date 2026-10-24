import { describe, expect, it } from 'vitest';
import { redactDeep } from './logger.js';

describe('redactDeep', () => {
  it('redacts nested password, kyc and card fields', () => {
    const redacted = redactDeep({
      user: {
        currentPassword: 'secret',
        newPassword: 'secret2',
        kyc: { nationalId: '001', iban: 'IR00', pan: '6037' },
        card_hash: 'abcd',
        cardHash: 'efgh',
      },
      req: {
        headers: {
          authorization: 'Bearer abc',
          'x-scope-distributor': 'uuid',
        },
      },
    }) as Record<string, unknown>;
    const user = redacted['user'] as Record<string, unknown>;
    const kyc = user['kyc'] as Record<string, unknown>;
    const headers = (redacted['req'] as Record<string, Record<string, unknown>>)['headers'];
    expect(user['currentPassword']).toBe('[REDACTED]');
    expect(user['newPassword']).toBe('[REDACTED]');
    expect(user['card_hash']).toBe('[REDACTED]');
    expect(user['cardHash']).toBe('[REDACTED]');
    expect(kyc['nationalId']).toBe('[REDACTED]');
    expect(kyc['iban']).toBe('[REDACTED]');
    expect(kyc['pan']).toBe('[REDACTED]');
    expect(headers?.['authorization']).toBe('[REDACTED]');
    expect(headers?.['x-scope-distributor']).toBe('[REDACTED]');
  });

  it('redacts JWKS and JWT private-key material', () => {
    const redacted = redactDeep({
      JWT_EDDSA_JWKS: '{"keys":[{"d":"secret"}]}',
      jwks: { keys: [{ kid: 'k1', d: 'secret' }] },
      privateKey: '-----BEGIN PRIVATE KEY-----',
      private_key: 'raw',
    }) as Record<string, unknown>;
    expect(redacted['JWT_EDDSA_JWKS']).toBe('[REDACTED]');
    expect(redacted['jwks']).toBe('[REDACTED]');
    expect(redacted['privateKey']).toBe('[REDACTED]');
    expect(redacted['private_key']).toBe('[REDACTED]');
  });
});
