import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { OtpPurpose } from '../../../notification/api.js';
import { OTP_CODE_DIGITS, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '../../domain/otpPolicy.js';

function keyPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

const PUT = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return 1
`;

const TAKE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'miss'} end
local sep = string.find(raw, '|', 1, true)
local digest = string.sub(raw, 1, sep - 1)
local attempts = tonumber(string.sub(raw, sep + 1)) + 1
if digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'ok'}
end
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {'locked'}
end
redis.call('SET', KEYS[1], digest .. '|' .. attempts, 'KEEPTTL')
return {'bad'}
`;

export function generateOtpCode(): string {
  const max = 10 ** OTP_CODE_DIGITS;
  return String(randomInt(0, max)).padStart(OTP_CODE_DIGITS, '0');
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

export async function putOtpChallenge(
  redis: Redis,
  input: { pepper: string; purpose: OtpPurpose; phone: string; code: string },
): Promise<void> {
  const digest = otpDigest(input.pepper, input.purpose, input.phone, input.code).toString('hex');
  const key = otpChallengeKey(input.purpose, otpPhoneHash(input.phone, input.pepper));
  await redis.eval(PUT, 1, key, `${digest}|0`, String(OTP_TTL_SECONDS));
}

export type OtpConsumeResult = 'ok' | 'invalid' | 'locked';

export async function consumeOtpChallenge(
  redis: Redis,
  input: { pepper: string; purpose: OtpPurpose; phone: string; code: string },
): Promise<OtpConsumeResult> {
  const candidate = otpDigest(input.pepper, input.purpose, input.phone, input.code);
  const dummy = otpDigest(input.pepper, input.purpose, input.phone, '000000');
  otpDigestsEqual(candidate, dummy);
  const key = otpChallengeKey(input.purpose, otpPhoneHash(input.phone, input.pepper));
  const raw = (await redis.eval(
    TAKE,
    1,
    key,
    candidate.toString('hex'),
    String(OTP_MAX_ATTEMPTS),
  )) as unknown[];
  const status = String(raw[0]);
  if (status === 'ok') return 'ok';
  if (status === 'locked') return 'locked';
  return 'invalid';
}
