import { describe, expect, it } from 'vitest';
import { maskIranMobile, smsHourSpike } from '../../domain/otpPolicy.js';
import { generateOtpCode, otpDigest, otpDigestsEqual } from './redisOtpStore.js';

describe('otp digest (J-5)', () => {
  it('uses timingSafeEqual on equal-length HMAC digests and CSPRNG 6-digit codes', () => {
    const a = otpDigest('pepper-32-bytes-minimum-value!!', 'app', '+989121111111', '042001');
    const b = otpDigest('pepper-32-bytes-minimum-value!!', 'app', '+989121111111', '042001');
    const c = otpDigest('pepper-32-bytes-minimum-value!!', 'staff', '+989121111111', '042001');
    expect(otpDigestsEqual(a, b)).toBe(true);
    expect(otpDigestsEqual(a, c)).toBe(false);
    // N17-5: equal-length HMAC compare stays available for tests; consume uses Lua ==.
    const codes = new Set(Array.from({ length: 40 }, () => generateOtpCode()));
    expect([...codes].every((code) => /^[0-9]{6}$/.test(code))).toBe(true);
    expect(codes.size).toBeGreaterThan(8);
    expect(generateOtpCode().length).toBe(6);
  });

  it('N17-7 / G7 mask: spike is 3x baseline; phone mask keeps no full number', () => {
    expect(smsHourSpike(3, 1)).toBe(false);
    expect(smsHourSpike(4, 1)).toBe(true);
    expect(smsHourSpike(100, undefined)).toBe(false);
    expect(maskIranMobile('+989121234567')).toBe('+989*****4567');
    expect(maskIranMobile('+989121234567')).not.toBe('+989121234567');
  });
});
