import type { Redis } from 'ioredis';
import type { Config } from '../../../platform/config.js';
import { AppError } from '../../../platform/http/errors.js';
import { limiterKeyPart } from './loginLimiter.js';

const RESERVE = `
local function ttl(key)
  local t = redis.call('TTL', key)
  if t > 0 then return t else return 0 end
end
local function bump(key, seconds)
  local n = redis.call('INCR', key)
  if n == 1 then redis.call('EXPIRE', key, seconds) end
end
local ipLim = tonumber(ARGV[1])
local dayLim = tonumber(ARGV[2])
if (tonumber(redis.call('GET', KEYS[1]) or '0') >= ipLim) then
  return {0, math.max(ttl(KEYS[1]), 1)}
end
if (tonumber(redis.call('GET', KEYS[2]) or '0') >= dayLim) then
  return {0, math.max(ttl(KEYS[2]), 1)}
end
bump(KEYS[1], 3600)
bump(KEYS[2], 86400)
return {1, 0}
`;

export interface DemoRateLimits {
  perIpHour: number;
  globalDay: number;
}

export function demoRateFromConfig(
  config: Pick<Config, 'RATE_DEMO_PER_IP_HOUR' | 'RATE_DEMO_GLOBAL_DAY'>,
): DemoRateLimits | undefined {
  if (config.RATE_DEMO_PER_IP_HOUR === undefined || config.RATE_DEMO_GLOBAL_DAY === undefined) {
    return undefined;
  }
  return { perIpHour: config.RATE_DEMO_PER_IP_HOUR, globalDay: config.RATE_DEMO_GLOBAL_DAY };
}

/** Shared A5+B5 counter. Unset limits stay uncapped. Redis failure is 503 before any DB access. */
export async function guardDemoLoginRate(
  redis: Redis | undefined,
  ip: string,
  limits: DemoRateLimits | undefined,
): Promise<void> {
  if (!limits) return;
  if (!redis) throw unavailable(2);
  let raw: unknown[];
  try {
    raw = (await redis.eval(
      RESERVE,
      2,
      `demo:lim:ip:${limiterKeyPart(ip)}`,
      'demo:lim:day',
      String(limits.perIpHour),
      String(limits.globalDay),
    )) as unknown[];
  } catch {
    throw unavailable(2);
  }
  if (Number(raw[0]) === 1) return;
  const retryAfter = Math.max(Number(raw[1]) || 1, 1);
  throw new AppError('RATE_LIMITED', 429, 'Too many requests', { retryAfter });
}

function unavailable(retryAfter: number): AppError {
  return new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
    retryAfter,
  });
}
