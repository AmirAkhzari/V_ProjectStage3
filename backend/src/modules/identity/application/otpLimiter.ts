import type { Redis } from 'ioredis';
import { limiterKeyPart } from './loginLimiter.js';
import {
  OTP_IP_PER_HOUR,
  OTP_IP_SLOWDOWN_AFTER,
  OTP_IP_SLOWDOWN_CAP_MS,
  OTP_IP_SLOWDOWN_MS,
  OTP_PHONE_PER_DAY,
  OTP_PHONE_PER_HOUR,
  OTP_RESEND_SECONDS,
  OTP_VERIFY_FAILS_PER_HOUR,
} from '../domain/otpPolicy.js';

/**
 * N14-2: standalone Redis. Keys hashed so IPv6 never splits slots.
 * Budget 0 = fail closed (no invented unlimited default).
 */
const RESERVE = `
local function ttl(key)
  local t = redis.call('TTL', key)
  if t > 0 then return t else return 0 end
end
local function incr_expire(key, seconds)
  local n = redis.call('INCR', key)
  if n == 1 then redis.call('EXPIRE', key, seconds) end
  return n
end
local hour_lim = tonumber(ARGV[2])
local day_lim = tonumber(ARGV[3])
local ip_lim = tonumber(ARGV[4])
local budget_h = tonumber(ARGV[5])
local budget_d = tonumber(ARGV[6])
if budget_h < 1 or budget_d < 1 then
  return {0, 60, 'budget'}
end
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {0, math.max(ttl(KEYS[1]), 1), 'phone60'}
end
local hour = tonumber(redis.call('GET', KEYS[2]) or '0')
if hour >= hour_lim then return {0, math.max(ttl(KEYS[2]), 1), 'phoneHour'} end
local day = tonumber(redis.call('GET', KEYS[3]) or '0')
if day >= day_lim then return {0, math.max(ttl(KEYS[3]), 1), 'phoneDay'} end
local ip = tonumber(redis.call('GET', KEYS[4]) or '0')
if ip >= ip_lim then return {0, math.max(ttl(KEYS[4]), 1), 'ip'} end
local bh = tonumber(redis.call('GET', KEYS[5]) or '0')
if bh >= budget_h then return {0, math.max(ttl(KEYS[5]), 1), 'budget'} end
local bd = tonumber(redis.call('GET', KEYS[6]) or '0')
if bd >= budget_d then return {0, math.max(ttl(KEYS[6]), 1), 'budget'} end
redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[1]))
hour = incr_expire(KEYS[2], 3600)
day = incr_expire(KEYS[3], 86400)
ip = incr_expire(KEYS[4], 3600)
bh = incr_expire(KEYS[5], 3600)
bd = incr_expire(KEYS[6], 86400)
return {1, hour, day, ip, bh, bd}
`;

const REFUND = `
local function decr_floor(key)
  local v = redis.call('GET', key)
  if not v then return end
  local n = tonumber(v) - 1
  if n <= 0 then redis.call('DEL', key) else redis.call('SET', key, n, 'KEEPTTL') end
end
redis.call('DEL', KEYS[1])
decr_floor(KEYS[2])
decr_floor(KEYS[3])
decr_floor(KEYS[4])
decr_floor(KEYS[5])
decr_floor(KEYS[6])
return 1
`;

const INCR_FAIL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
return n
`;

export interface OtpBudgetLimits {
  hour: number;
  day: number;
  spikeBaselineHour?: number;
}

export type OtpSendReservation =
  | { status: 'blocked'; retryAfter: number; reason: string }
  | { status: 'reserved'; delayMs: number; hourCount: number; phone: string; ip: string };

function phoneHash(phone: string): string {
  return limiterKeyPart(phone);
}

export function otpLimitKeys(
  phone: string,
  ip: string,
): {
  phone60: string;
  phoneHour: string;
  phoneDay: string;
  ipHour: string;
  budgetHour: string;
  budgetDay: string;
  verifyFail: string;
} {
  const p = phoneHash(phone);
  const i = limiterKeyPart(ip);
  return {
    phone60: `otp:lim:p60:${p}`,
    phoneHour: `otp:lim:ph:${p}`,
    phoneDay: `otp:lim:pd:${p}`,
    ipHour: `otp:lim:ip:${i}`,
    budgetHour: 'otp:budget:hour',
    budgetDay: 'otp:budget:day',
    verifyFail: `otp:vfail:${p}`,
  };
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export async function reserveOtpSend(
  redis: Redis,
  phone: string,
  ip: string,
  budget: OtpBudgetLimits,
): Promise<OtpSendReservation> {
  const keys = otpLimitKeys(phone, ip);
  const raw = (await redis.eval(
    RESERVE,
    6,
    keys.phone60,
    keys.phoneHour,
    keys.phoneDay,
    keys.ipHour,
    keys.budgetHour,
    keys.budgetDay,
    String(OTP_RESEND_SECONDS),
    String(OTP_PHONE_PER_HOUR),
    String(OTP_PHONE_PER_DAY),
    String(OTP_IP_PER_HOUR),
    String(budget.hour),
    String(budget.day),
  )) as unknown[];
  if (asNumber(raw[0]) === 0) {
    return { status: 'blocked', retryAfter: Math.max(asNumber(raw[1]), 1), reason: String(raw[2]) };
  }
  const ipCount = asNumber(raw[3]);
  const extra = Math.max(0, ipCount - OTP_IP_SLOWDOWN_AFTER);
  const delayMs = Math.min(extra * OTP_IP_SLOWDOWN_MS, OTP_IP_SLOWDOWN_CAP_MS);
  return {
    status: 'reserved',
    delayMs,
    hourCount: asNumber(raw[4]),
    phone,
    ip,
  };
}

export async function refundOtpSend(redis: Redis, phone: string, ip: string): Promise<void> {
  const keys = otpLimitKeys(phone, ip);
  await redis.eval(
    REFUND,
    6,
    keys.phone60,
    keys.phoneHour,
    keys.phoneDay,
    keys.ipHour,
    keys.budgetHour,
    keys.budgetDay,
  );
}

export async function recordOtpVerifyFail(redis: Redis, phone: string): Promise<number> {
  const keys = otpLimitKeys(phone, '0');
  return asNumber(await redis.eval(INCR_FAIL, 1, keys.verifyFail));
}

export function otpVerifyFailLimited(count: number): boolean {
  return count > OTP_VERIFY_FAILS_PER_HOUR;
}
