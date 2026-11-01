import type { Redis } from 'ioredis';
import {
  LOGIN_FAILURES_TO_LOCK,
  LOGIN_IP_FAIL_LIMIT,
  LOGIN_IP_WINDOW_SECONDS,
  LOGIN_LOCK_SECONDS,
  LOGIN_TARPIT_CAP_SECONDS,
  LOGIN_TARPIT_MAX_CONCURRENT,
  nextBackoffSeconds,
  tarpitDelaySeconds,
} from '../domain/loginPolicy.js';

const INCR_EXPIRE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

const SET_LOCK_NX = `
return redis.call('SET', KEYS[1], '1', 'NX', 'EX', tonumber(ARGV[1]))
`;

const LOGIN_USER_FAIL_WINDOW = 60 * 60;

export interface LoginLimiterLimits {
  userIpFails?: number;
  ipFails?: number;
  tarpitAfter?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LoginBlock {
  retryAfter: number;
}

export interface LoginFailureOutcome {
  locked: boolean;
  limited: boolean;
  retryAfter: number;
}

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

async function incrExpire(redis: Redis, key: string, ttlSeconds: number): Promise<number> {
  const n = await redis.eval(INCR_EXPIRE, 1, key, String(ttlSeconds));
  return typeof n === 'number' ? n : Number(n);
}

async function setLockNx(redis: Redis, key: string, ttlSeconds: number): Promise<boolean> {
  const set = await redis.eval(SET_LOCK_NX, 1, key, String(ttlSeconds));
  return set === 'OK';
}

async function positiveTtl(redis: Redis, key: string): Promise<number> {
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}

/** Peek existing locks / IP cap. A failure while locked must not re-arm. */
export async function peekLoginBlock(
  redis: Redis,
  username: string,
  ip: string,
  limits: LoginLimiterLimits = {},
): Promise<LoginBlock | undefined> {
  const ipLimit = limits.ipFails ?? LOGIN_IP_FAIL_LIMIT;
  const [uipTtl, userTtl, ipFails] = await Promise.all([
    positiveTtl(redis, userIpLockKey(username, ip)),
    positiveTtl(redis, userLockKey(username)),
    redis.get(ipFailKey(ip)).then((value) => Number(value ?? 0)),
  ]);
  if (uipTtl > 0 || userTtl > 0) {
    return { retryAfter: Math.max(uipTtl, userTtl, 1) };
  }
  if (ipFails >= ipLimit) {
    const ttl = await positiveTtl(redis, ipFailKey(ip));
    return { retryAfter: ttl > 0 ? ttl : LOGIN_IP_WINDOW_SECONDS };
  }
  return undefined;
}

/**
 * Count a failure. Lock keys use SET NX so a failure while locked cannot extend the lock.
 * Unknown and real usernames take this same Redis path (no account write).
 */
export async function recordLoginFailure(
  redis: Redis,
  username: string,
  ip: string,
  limits: LoginLimiterLimits = {},
): Promise<LoginFailureOutcome> {
  const userIpLimit = limits.userIpFails ?? LOGIN_FAILURES_TO_LOCK;
  const ipLimit = limits.ipFails ?? LOGIN_IP_FAIL_LIMIT;
  const [uipFails, userFails, ipFails] = await Promise.all([
    incrExpire(redis, userIpFailKey(username, ip), LOGIN_LOCK_SECONDS),
    incrExpire(redis, userFailKey(username), LOGIN_USER_FAIL_WINDOW),
    incrExpire(redis, ipFailKey(ip), LOGIN_IP_WINDOW_SECONDS),
  ]);

  let locked = false;
  if (uipFails === userIpLimit) {
    locked = (await setLockNx(redis, userIpLockKey(username, ip), LOGIN_LOCK_SECONDS)) || locked;
  }
  const backoff = nextBackoffSeconds(userFails);
  if (backoff !== null) {
    locked = (await setLockNx(redis, userLockKey(username), backoff)) || locked;
  }

  if (ipFails > ipLimit) {
    const ttl = await positiveTtl(redis, ipFailKey(ip));
    return { locked, limited: true, retryAfter: ttl > 0 ? ttl : LOGIN_IP_WINDOW_SECONDS };
  }

  const delay = tarpitDelaySeconds(ipFails, limits.tarpitAfter);
  if (delay > 0) {
    const inflight = await incrExpire(redis, tarpitKey(ip), LOGIN_TARPIT_CAP_SECONDS);
    if (inflight > LOGIN_TARPIT_MAX_CONCURRENT) {
      return { locked, limited: true, retryAfter: delay };
    }
    await (limits.sleep ?? defaultSleep)(delay * 1000);
  }

  const retryAfter = locked
    ? Math.max(
        await positiveTtl(redis, userIpLockKey(username, ip)),
        await positiveTtl(redis, userLockKey(username)),
        1,
      )
    : 0;
  return { locked, limited: false, retryAfter };
}

/** AUTH-LG-04: success clears username counters. Per-IP (c) is never cleared. */
export async function clearLoginCounters(
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
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
