import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { OtpPurpose } from '../../../notification/api.js';
import {
  OTP_CODE_DIGITS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  OTP_VERIFY_FAILS_PER_HOUR,
} from '../../domain/otpPolicy.js';

function keyPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

const PUT = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return 1
`;

/**
 * N17-5: digest compare is Lua `==` on peppered HMAC-SHA256 hex, not constant-time
 * and not a JS `timingSafeEqual`. HMAC unforgeability is the control.
 * N17-3: verify-fail (10/phone/hour) is checked BEFORE consume; bad/locked/miss INCR.
 */
const TAKE = `
local function incr_fail()
  local n = redis.call('INCR', KEYS[2])
  if n == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
  return n
end
local limit = tonumber(ARGV[3])
local fails = tonumber(redis.call('GET', KEYS[2]) or '0')
if fails >= limit then
  local t = redis.call('TTL', KEYS[2])
  if t < 1 then t = 1 end
  return {'limited', t}
end
local raw = redis.call('GET', KEYS[1])
if not raw then
  incr_fail()
  return {'miss'}
end
local p1 = string.find(raw, '|', 1, true)
if not p1 then
  incr_fail()
  return {'miss'}
end
local p2 = string.find(raw, '|', p1 + 1, true)
local digest = string.sub(raw, 1, p1 - 1)
local attempts
local issuance
if p2 then
  attempts = tonumber(string.sub(raw, p1 + 1, p2 - 1)) + 1
  issuance = string.sub(raw, p2 + 1)
else
  attempts = tonumber(string.sub(raw, p1 + 1)) + 1
  issuance = ''
end
if digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'ok'}
end
incr_fail()
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {'locked'}
end
redis.call('SET', KEYS[1], digest .. '|' .. attempts .. '|' .. issuance, 'KEEPTTL')
return {'bad'}
`;

const DELETE_IF = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local p1 = string.find(raw, '|', 1, true)
if not p1 then return 0 end
local p2 = string.find(raw, '|', p1 + 1, true)
local issuance = p2 and string.sub(raw, p2 + 1) or ''
if issuance == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export function generateOtpCode(): string {
  const max = 10 ** OTP_CODE_DIGITS;
  return String(randomInt(0, max)).padStart(OTP_CODE_DIGITS, '0');
}

export function newOtpIssuanceId(): string {
  return randomBytes(16).toString('hex');
}

export function otpPhoneHash(phone: string, pepper: string): string {
  return keyPart(createHmac('sha256', pepper).update(phone, 'utf8').digest('hex'));
}

export function otpDigest(
  pepper: string,
  purpose: OtpPurpose,
  phone: string,
  code: string,
): Buffer {
  return createHmac('sha256', pepper).update(`${purpose}:${phone}:${code}`, 'utf8').digest();
}

export function otpDigestsEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function otpChallengeKey(purpose: OtpPurpose, phoneHash: string): string {
  return `otp:${purpose}:${phoneHash}`;
}

export function otpVerifyFailKey(phoneHash: string): string {
  return `otp:vfail:${phoneHash}`;
}

export async function putOtpChallenge(
  redis: Redis,
  input: {
    pepper: string;
    purpose: OtpPurpose;
    phone: string;
    code: string;
    issuanceId: string;
  },
): Promise<void> {
  const digest = otpDigest(input.pepper, input.purpose, input.phone, input.code).toString('hex');
  const key = otpChallengeKey(input.purpose, otpPhoneHash(input.phone, input.pepper));
  await redis.eval(PUT, 1, key, `${digest}|0|${input.issuanceId}`, String(OTP_TTL_SECONDS));
}

export type OtpConsumeStatus = 'ok' | 'invalid' | 'locked' | 'limited';

export interface OtpConsumeResult {
  status: OtpConsumeStatus;
  retryAfter?: number;
}

export async function consumeOtpChallenge(
  redis: Redis,
  input: { pepper: string; purpose: OtpPurpose; phone: string; code: string },
): Promise<OtpConsumeResult> {
  const candidate = otpDigest(input.pepper, input.purpose, input.phone, input.code);
  const phoneHash = otpPhoneHash(input.phone, input.pepper);
  const key = otpChallengeKey(input.purpose, phoneHash);
  const raw = (await redis.eval(
    TAKE,
    2,
    key,
    otpVerifyFailKey(phoneHash),
    candidate.toString('hex'),
    String(OTP_MAX_ATTEMPTS),
    String(OTP_VERIFY_FAILS_PER_HOUR),
  )) as unknown[];
  const status = String(raw[0]);
  if (status === 'ok') return { status: 'ok' };
  if (status === 'locked') return { status: 'locked' };
  if (status === 'limited') {
    const retry = typeof raw[1] === 'number' ? raw[1] : Number(raw[1]);
    return { status: 'limited', retryAfter: Math.max(retry || 1, 1) };
  }
  return { status: 'invalid' };
}

/** R15-4: delete only when the stored issuance still matches (late reject ≠ newer challenge). */
export async function deleteOtpChallengeIfIssuance(
  redis: Redis,
  input: { pepper: string; purpose: OtpPurpose; phone: string; issuanceId: string },
): Promise<boolean> {
  const key = otpChallengeKey(input.purpose, otpPhoneHash(input.phone, input.pepper));
  const raw = await redis.eval(DELETE_IF, 1, key, input.issuanceId);
  return raw === 1 || raw === '1';
}
