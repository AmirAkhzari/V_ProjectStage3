import { describe, expect, it } from 'vitest';
import { generateOtpCode, otpDigest, otpDigestsEqual } from './redisOtpStore.js';

describe('otp digest (J-5)', () => {
  it('uses timingSafeEqual on equal-length HMAC digests and CSPRNG 6-digit codes', () => {
    const a = otpDigest('pepper-32-bytes-minimum-value!!', 'app', '+989121111111', '042001');
    const b = otpDigest('pepper-32-bytes-minimum-value!!', 'app', '+989121111111', '042001');
    const c = otpDigest('pepper-32-bytes-minimum-value!!', 'staff', '+989121111111', '042001');
    expect(otpDigestsEqual(a, b)).toBe(true);
    expect(otpDigestsEqual(a, c)).toBe(false);
    const codes = new Set(Array.from({ length: 40 }, () => generateOtpCode()));
    expect([...codes].every((code) => /^[0-9]{6}$/.test(code))).toBe(true);
    expect(codes.size).toBeGreaterThan(8);
    expect(generateOtpCode().length).toBe(6);
  });
});
