/** LIM-OTP-01c/e: 6-digit CSPRNG, TTL 120s, 5 attempts, resend 60s. */
export const OTP_TTL_SECONDS = 120;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_CODE_DIGITS = 6;

/** LIM-OTP-01a/b: per-phone, shared A1/B1. */
export const OTP_PHONE_PER_60S = 1;
export const OTP_PHONE_PER_HOUR = 5;
export const OTP_PHONE_PER_DAY = 10;
export const OTP_IP_PER_HOUR = 20;
export const OTP_VERIFY_FAILS_PER_HOUR = 10;

/** Conservative IP slowdown below cap until Amir sets a schedule. After 10/20: +100ms each, cap 1s. */
export const OTP_IP_SLOWDOWN_AFTER = 10;
export const OTP_IP_SLOWDOWN_MS = 100;
export const OTP_IP_SLOWDOWN_CAP_MS = 1000;

/** N17-7: alert when the hourly send count exceeds 3× the configured baseline. */
export const OTP_SPIKE_MULTIPLIER = 3;

export function smsHourSpike(hourCount: number, baseline: number | undefined): boolean {
  return baseline !== undefined && baseline >= 1 && hourCount > OTP_SPIKE_MULTIPLIER * baseline;
}

/** Log-safe mask; never a full Iran mobile. */
export function maskIranMobile(phone: string): string {
  if (phone.length < 8) return '+98*****';
  return `${phone.slice(0, 4)}*****${phone.slice(-4)}`;
}
