import { describe, expect, it } from 'vitest';
import { InsecureMockPasswordHasher, MockOtpService, MockTokenService } from './mockAuth.js';

describe('mock auth ports', () => {
  it('issues opaque tokens and records revocation', async () => {
    const tokens = new MockTokenService();
    const issued = await tokens.issue({ sub: 'u', typ: 'driver', sid: 's1' });
    expect(issued.accessToken.startsWith('mock-')).toBe(true);
    await tokens.revokeSession('s1');
    expect(tokens.revoked.has('s1')).toBe(true);
  });

  it('locks OTP after max attempts', async () => {
    const otp = new MockOtpService({
      generateCode: () => '12345',
      ttlMs: 60_000,
      maxAttempts: 2,
      now: () => new Date(0),
    });
    const challenge = await otp.issue('09120000000');
    expect(await otp.verify(challenge.challengeId, '00000')).toBe('invalid');
    expect(await otp.verify(challenge.challengeId, '00000')).toBe('invalid');
    expect(await otp.verify(challenge.challengeId, '12345')).toBe('locked');
  });

  it('is not a real password hash', async () => {
    const hasher = new InsecureMockPasswordHasher();
    const hash = await hasher.hash('secret');
    expect(hash.startsWith('mock$')).toBe(true);
    expect(await hasher.verify(hash, 'secret')).toBe(true);
    expect(await hasher.verify(hash, 'other')).toBe(false);
  });

  it('refuses to construct in production', () => {
    expect(() => new InsecureMockPasswordHasher('production')).toThrow(/forbidden in production/);
  });
});
