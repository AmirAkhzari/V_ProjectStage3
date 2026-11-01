import type { Redis } from 'ioredis';
import {
  LOGIN_BACKOFF_SECONDS,
  LOGIN_FAILURES_TO_LOCK,
  LOGIN_IP_FAIL_LIMIT,
  LOGIN_IP_WINDOW_SECONDS,
  LOGIN_LOCK_SECONDS,
  LOGIN_TARPIT_CAP_SECONDS,
  LOGIN_TARPIT_MAX_CONCURRENT,
  tarpitDelaySeconds,
} from '../domain/loginPolicy.js';

/**
 * Atomically: if a lock/cap is already hit, return blocked without incrementing
 * (a failure while locked must not re-arm). Otherwise INCR the three counters
 * and SET NX locks. Call this BEFORE argon2 verify (R2-1 / R13-1).
 */
const RESERVE_ATTEMPT = `
local function ttl(key)
  local t = redis.call('TTL', key)
  if t > 0 then return t else return 0 end
end
local function incr_expire(key, seconds)
  local n = redis.call('INCR', key)
  if n == 1 then redis.call('EXPIRE', key, seconds) end
  return n
end

local uip_lock = ttl(KEYS[2])
local user_lock = ttl(KEYS[4])
if uip_lock > 0 or user_lock > 0 then
  return {0, math.max(uip_lock, user_lock, 1)}
end

local user_ip_limit = tonumber(ARGV[1])
local ip_limit = tonumber(ARGV[2])
local uip = tonumber(redis.call('GET', KEYS[1]) or '0')
local ip = tonumber(redis.call('GET', KEYS[5]) or '0')
if uip >= user_ip_limit then
  return {0, math.max(ttl(KEYS[1]), 1)}
end
if ip >= ip_limit then
  return {0, math.max(ttl(KEYS[5]), tonumber(ARGV[5]), 1)}
end

uip = incr_expire(KEYS[1], tonumber(ARGV[3]))
local user = incr_expire(KEYS[3], tonumber(ARGV[4]))
ip = incr_expire(KEYS[5], tonumber(ARGV[5]))

local locked = 0
if uip == user_ip_limit then
  if redis.call('SET', KEYS[2], '1', 'NX', 'EX', tonumber(ARGV[6])) then locked = 1 end
end
if user >= user_ip_limit then
  local stage = math.min(math.floor(user / user_ip_limit) - 1, 3)
  local backoff = tonumber(ARGV[7 + stage])
  if redis.call('SET', KEYS[4], '1', 'NX', 'EX', backoff) then locked = 1 end
end
return {1, locked, uip, user, ip}
`;

const REFUND_IP = `
local n = redis.call('DECR', KEYS[1])
if n <= 0 then redis.call('DEL', KEYS[1]) end
return n
`;

const INCR_EXPIRE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

const LOGIN_USER_FAIL_WINDOW = 60 * 60;

export interface LoginLimiterLimits {
  userIpFails?: number;
  ipFails?: number;
  tarpitAfter?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type LoginReservation =
  | { status: 'blocked'; retryAfter: number }
  | {
      status: 'reserved';
      locked: boolean;
      uipFails: number;
      userFails: number;
      ipFails: number;
    };

function userIpFailKey(username: string, ip: string): string {
  return `login:fail:uip:${username}:${ip}`;
}
function userIpLockKey(username: string, ip: string): string {
  return `login:lock:uip:${username}:${ip}`;
}
function userFailKey(username: string): string {
  return `login:fail:user:${username}`;
}
function userLockKey(username: string): string {
  return `login:lock:user:${username}`;
}
function ipFailKey(ip: string): string {
  return `login:fail:ip:${ip}`;
}
function tarpitKey(ip: string): string {
  return `login:tarpit:${ip}`;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export async function reserveLoginAttempt(
  redis: Redis,
  username: string,
  ip: string,
  limits: LoginLimiterLimits = {},
): Promise<LoginReservation> {
  const userIpLimit = limits.userIpFails ?? LOGIN_FAILURES_TO_LOCK;
  const ipLimit = limits.ipFails ?? LOGIN_IP_FAIL_LIMIT;
  const raw = (await redis.eval(
    RESERVE_ATTEMPT,
    5,
    userIpFailKey(username, ip),
    userIpLockKey(username, ip),
    userFailKey(username),
    userLockKey(username),
    ipFailKey(ip),
    String(userIpLimit),
    String(ipLimit),
    String(LOGIN_LOCK_SECONDS),
    String(LOGIN_USER_FAIL_WINDOW),
    String(LOGIN_IP_WINDOW_SECONDS),
    String(LOGIN_LOCK_SECONDS),
    ...LOGIN_BACKOFF_SECONDS.map(String),
  )) as unknown[];
  if (asNumber(raw[0]) === 0) {
    return { status: 'blocked', retryAfter: Math.max(asNumber(raw[1]), 1) };
  }
  const reserved = {
    status: 'reserved' as const,
    locked: asNumber(raw[1]) === 1,
    uipFails: asNumber(raw[2]),
    userFails: asNumber(raw[3]),
    ipFails: asNumber(raw[4]),
  };
  const delay = tarpitDelaySeconds(reserved.ipFails, limits.tarpitAfter);
  if (delay > 0) {
    const inflight = asNumber(
      await redis.eval(INCR_EXPIRE, 1, tarpitKey(ip), String(LOGIN_TARPIT_CAP_SECONDS)),
    );
    if (inflight > LOGIN_TARPIT_MAX_CONCURRENT) {
      return { status: 'blocked', retryAfter: delay };
    }
    await (limits.sleep ?? defaultSleep)(delay * 1000);
  }
  return reserved;
}

/** AUTH-LG-04: success clears username counters and refunds the reserved IP increment. */
export async function settleLoginSuccess(
  redis: Redis,
  username: string,
  ip: string,
): Promise<void> {
  await redis.del(
    userIpFailKey(username, ip),
    userIpLockKey(username, ip),
    userFailKey(username),
    userLockKey(username),
  );
  await redis.eval(REFUND_IP, 1, ipFailKey(ip));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
