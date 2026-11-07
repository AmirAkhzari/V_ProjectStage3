import { randomBytes } from 'node:crypto';
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
} from '../domain/otpPolicy.js';
import { otpPhoneHash } from '../infra/otp/redisOtpStore.js';

/**
 * N14-2: standalone Redis. Keys hashed so IPv6 never splits slots.
 * N17-4: phone parts are peppered HMAC, not plain sha256.
 * N17-2 / R15-3: budget ints are validated before EVAL; Lua also rejects nil/NaN/inf.
 * Dev/fake skip budget (ARGV skip=1). Unset/non-positive budget fail-closed when applied.
 * R15-2: rsv payload binds token + IP hash + counts + per-window ids.
 */
const RESERVE = `
local function ttl(key)
  local t = redis.call('TTL', key)
  if t > 0 then return t else return 0 end
end
local function incr_with_window(key, winKey, seconds)
  local n = redis.call('INCR', key)
  local t = redis.call('TTL', key)
  if t < 0 then redis.call('EXPIRE', key, seconds) end
  if n == 1 then
    local now = redis.call('TIME')
    redis.call('SET', winKey, now[1] .. '-' .. now[2], 'EX', seconds)
  elseif redis.call('EXISTS', winKey) == 0 then
    local now = redis.call('TIME')
    redis.call('SET', winKey, now[1] .. '-' .. now[2], 'EX', seconds)
  end
  return n, redis.call('GET', winKey) or ''
end
local function bad_budget(x)
  return x == nil or x ~= x or x == math.huge or x < 1
end
local hour_lim = tonumber(ARGV[2])
local day_lim = tonumber(ARGV[3])
local ip_lim = tonumber(ARGV[4])
local skip_budget = ARGV[7] == '1'
if not skip_budget then
  local budget_h = tonumber(ARGV[5])
  local budget_d = tonumber(ARGV[6])
  if bad_budget(budget_h) or bad_budget(budget_d) then
    return {0, 60, 'budget'}
  end
  local bh = tonumber(redis.call('GET', KEYS[5]) or '0')
  if bh >= budget_h then return {0, math.max(ttl(KEYS[5]), 1), 'budget'} end
  local bd = tonumber(redis.call('GET', KEYS[6]) or '0')
  if bd >= budget_d then return {0, math.max(ttl(KEYS[6]), 1), 'budget'} end
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
redis.call('SET', KEYS[1], ARGV[8], 'EX', tonumber(ARGV[1]))
local hw, dw, iw, bhw, bdw = '', '', '', '', ''
hour, hw = incr_with_window(KEYS[2], KEYS[8], 3600)
day, dw = incr_with_window(KEYS[3], KEYS[9], 86400)
ip, iw = incr_with_window(KEYS[4], KEYS[10], 3600)
local bh, bd = 0, 0
if not skip_budget then
  bh, bhw = incr_with_window(KEYS[5], KEYS[11], 3600)
  bd, bdw = incr_with_window(KEYS[6], KEYS[12], 86400)
end
redis.call('SET', KEYS[7], table.concat({ARGV[9], hour, day, ip, bh, bd, hw, dw, iw, bhw, bdw}, '|'), 'EX', 86400)
return {1, hour, day, ip, bh, bd}
`;

/** R15-2: token-bound, idempotent; wrong IP and rolled windows are no-ops. */
const REFUND = `
local function decr_floor(key)
  local v = redis.call('GET', key)
  if not v then return end
  local n = tonumber(v) - 1
  if n <= 0 then redis.call('DEL', key) else redis.call('SET', key, n, 'KEEPTTL') end
end
local function maybe_decr(key, winKey, expected, expectedWin)
  expected = tonumber(expected)
  if expected == nil or expected < 1 then return end
  if expectedWin == nil or expectedWin == '' then return end
  if redis.call('GET', winKey) ~= expectedWin then return end
  decr_floor(key)
end
local payload = redis.call('GET', KEYS[7])
if not payload then return 0 end
local parts = {}
local start = 1
for i = 1, 10 do
  local p = string.find(payload, '|', start, true)
  if not p then return 0 end
  parts[i] = string.sub(payload, start, p - 1)
  start = p + 1
end
parts[11] = string.sub(payload, start)
if parts[1] ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[7])
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
maybe_decr(KEYS[2], KEYS[8], parts[2], parts[7])
maybe_decr(KEYS[3], KEYS[9], parts[3], parts[8])
maybe_decr(KEYS[4], KEYS[10], parts[4], parts[9])
maybe_decr(KEYS[5], KEYS[11], parts[5], parts[10])
maybe_decr(KEYS[6], KEYS[12], parts[6], parts[11])
return 1
`;

/** N19-1: suppression refunds global SMS budget only; phone/IP counters stay. */
const REFUND_BUDGET = `
local function decr_floor(key)
  local v = redis.call('GET', key)
  if not v then return end
  local n = tonumber(v) - 1
  if n <= 0 then redis.call('DEL', key) else redis.call('SET', key, n, 'KEEPTTL') end
end
local function maybe_decr(key, winKey, expected, expectedWin)
  expected = tonumber(expected)
  if expected == nil or expected < 1 then return end
  if expectedWin == nil or expectedWin == '' then return end
  if redis.call('GET', winKey) ~= expectedWin then return end
  decr_floor(key)
end
local payload = redis.call('GET', KEYS[7])
if not payload then return 0 end
local parts = {}
local start = 1
for i = 1, 10 do
  local p = string.find(payload, '|', start, true)
  if not p then return 0 end
  parts[i] = string.sub(payload, start, p - 1)
  start = p + 1
end
parts[11] = string.sub(payload, start)
if parts[1] ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[7])
maybe_decr(KEYS[5], KEYS[11], parts[5], parts[10])
maybe_decr(KEYS[6], KEYS[12], parts[6], parts[11])
return 1
`;

export interface OtpBudgetLimits {
  hour: number;
  day: number;
  spikeBaselineHour?: number;
  /** Dev/fake: do not check or increment global budget keys. */
  skipBudget?: boolean;
}

export type OtpSendReservation =
  | { status: 'blocked'; retryAfter: number; reason: string }
  | { status: 'reserved'; token: string; delayMs: number; hourCount: number };

export function otpLimitKeys(
  phone: string,
  ip: string,
  pepper: string,
  token = '',
): {
  phone60: string;
  phoneHour: string;
  phoneDay: string;
  ipHour: string;
  budgetHour: string;
  budgetDay: string;
  rsv: string;
  phoneHourWin: string;
  phoneDayWin: string;
  ipHourWin: string;
  budgetHourWin: string;
  budgetDayWin: string;
} {
  const p = otpPhoneHash(phone, pepper);
  const i = limiterKeyPart(ip);
  return {
    phone60: `otp:lim:p60:${p}`,
    phoneHour: `otp:lim:ph:${p}`,
    phoneDay: `otp:lim:pd:${p}`,
    ipHour: `otp:lim:ip:${i}`,
    budgetHour: 'otp:budget:hour',
    budgetDay: 'otp:budget:day',
    rsv: `otp:lim:rsv:${token}`,
    phoneHourWin: `otp:lim:phw:${p}`,
    phoneDayWin: `otp:lim:pdw:${p}`,
    ipHourWin: `otp:lim:ipw:${i}`,
    budgetHourWin: 'otp:budget:hour:w',
    budgetDayWin: 'otp:budget:day:w',
  };
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

/** N17-2: finite safe integers only; never String(undefined) into Lua. */
export function luaSafeInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid lua int: ${name}`);
  }
  return value;
}

function positiveBudgetInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function evalKeys(keys: ReturnType<typeof otpLimitKeys>): string[] {
  return [
    keys.phone60,
    keys.phoneHour,
    keys.phoneDay,
    keys.ipHour,
    keys.budgetHour,
    keys.budgetDay,
    keys.rsv,
    keys.phoneHourWin,
    keys.phoneDayWin,
    keys.ipHourWin,
    keys.budgetHourWin,
    keys.budgetDayWin,
  ];
}

export async function reserveOtpSend(
  redis: Redis,
  phone: string,
  ip: string,
  pepper: string,
  budget: OtpBudgetLimits,
): Promise<OtpSendReservation> {
  const skip = budget.skipBudget === true;
  if (!skip && (!positiveBudgetInt(budget.hour) || !positiveBudgetInt(budget.day))) {
    return { status: 'blocked', retryAfter: 60, reason: 'budget' };
  }
  const hour = skip ? 0 : budget.hour;
  const day = skip ? 0 : budget.day;
  const token = randomBytes(16).toString('hex');
  const ipHash = limiterKeyPart(ip);
  const keys = otpLimitKeys(phone, ip, pepper, token);
  const raw = (await redis.eval(
    RESERVE,
    12,
    ...evalKeys(keys),
    String(luaSafeInt(OTP_RESEND_SECONDS, 'OTP_RESEND_SECONDS')),
    String(luaSafeInt(OTP_PHONE_PER_HOUR, 'OTP_PHONE_PER_HOUR')),
    String(luaSafeInt(OTP_PHONE_PER_DAY, 'OTP_PHONE_PER_DAY')),
    String(luaSafeInt(OTP_IP_PER_HOUR, 'OTP_IP_PER_HOUR')),
    String(hour),
    String(day),
    skip ? '1' : '0',
    token,
    ipHash,
  )) as unknown[];
  if (asNumber(raw[0]) === 0) {
    return { status: 'blocked', retryAfter: Math.max(asNumber(raw[1]), 1), reason: String(raw[2]) };
  }
  const ipCount = asNumber(raw[3]);
  const extra = Math.max(0, ipCount - OTP_IP_SLOWDOWN_AFTER);
  const delayMs = Math.min(extra * OTP_IP_SLOWDOWN_MS, OTP_IP_SLOWDOWN_CAP_MS);
  return { status: 'reserved', token, delayMs, hourCount: asNumber(raw[4]) };
}

export async function refundOtpSend(
  redis: Redis,
  phone: string,
  ip: string,
  pepper: string,
  token: string,
): Promise<number> {
  const keys = otpLimitKeys(phone, ip, pepper, token);
  return asNumber(await redis.eval(REFUND, 12, ...evalKeys(keys), token, limiterKeyPart(ip)));
}

/** N19-1: refund otp:budget:* only; leave phone/IP reservation counters. */
export async function refundOtpBudgetOnly(
  redis: Redis,
  phone: string,
  ip: string,
  pepper: string,
  token: string,
): Promise<number> {
  const keys = otpLimitKeys(phone, ip, pepper, token);
  return asNumber(
    await redis.eval(REFUND_BUDGET, 12, ...evalKeys(keys), token, limiterKeyPart(ip)),
  );
}
