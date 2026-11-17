import { createHash } from 'node:crypto';
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
 * N14-2: limiter + session deny Lua uses standalone GET/INCR/SET NX/DEL on
 * distinct keys. Deploy a single-node Redis (no Cluster hash-slot split).
 * Cluster would need `{login}` hash tags on every key.
 *
 * IPv6: username/IP are hashed; keys never join raw host:port with extra colons.
 */

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
  return {0, math.max(uip_lock, user_lock, 1), 0, 0}
end

local user_ip_limit = tonumber(ARGV[1])
local ip_limit = tonumber(ARGV[2])
local uip = tonumber(redis.call('GET', KEYS[1]) or '0')
local ip = tonumber(redis.call('GET', KEYS[5]) or '0')
if uip >= user_ip_limit then
  return {0, math.max(ttl(KEYS[1]), 1), 0, 0}
end
if ip >= ip_limit then
  return {0, math.max(ttl(KEYS[5]), tonumber(ARGV[5]), 1), 0, 0}
end

uip = incr_expire(KEYS[1], tonumber(ARGV[3]))
local user = incr_expire(KEYS[3], tonumber(ARGV[4]))
ip = incr_expire(KEYS[5], tonumber(ARGV[5]))

local locked_uip = 0
local locked_user = 0
if uip == user_ip_limit then
  if redis.call('SET', KEYS[2], '1', 'NX', 'EX', tonumber(ARGV[6])) then locked_uip = 1 end
end
if user >= user_ip_limit then
  local stage = math.min(math.floor(user / user_ip_limit) - 1, 3)
  local backoff = tonumber(ARGV[7 + stage])
  if redis.call('SET', KEYS[4], '1', 'NX', 'EX', backoff) then locked_user = 1 end
end
return {1, locked_uip, locked_user, uip, user, ip}
`;

const DECR_FLOOR = `
local n = redis.call('DECR', KEYS[1])
if n <= 0 then redis.call('DEL', KEYS[1]) end
return n
`;

const SETTLE_SUCCESS = `
local function decr_floor(key)
  local v = redis.call('GET', key)
  if not v then return end
  local n = tonumber(v) - 1
  if n <= 0 then redis.call('DEL', key) else redis.call('SET', key, n, 'KEEPTTL') end
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[4])
decr_floor(KEYS[5])
if ARGV[1] == '1' then decr_floor(KEYS[6]) end
return 1
`;

const REFUND_ATTEMPT = `
local function decr_floor(key)
  local v = redis.call('GET', key)
  if not v then return end
  local n = tonumber(v) - 1
  if n <= 0 then redis.call('DEL', key) else redis.call('SET', key, n, 'KEEPTTL') end
end
decr_floor(KEYS[1])
if ARGV[1] == '1' then redis.call('DEL', KEYS[2]) end
decr_floor(KEYS[3])
if ARGV[2] == '1' then redis.call('DEL', KEYS[4]) end
decr_floor(KEYS[5])
if ARGV[3] == '1' then decr_floor(KEYS[6]) end
return 1
`;

const INCR_EXPIRE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

const LOGIN_USER_FAIL_WINDOW = 60 * 60;

/** LIM-C11-01: 5 wrong current-password attempts per driver account per rolling 15 minutes. */
export const PASSWORD_CHANGE_MAX_ATTEMPTS = 5;
export const PASSWORD_CHANGE_WINDOW_SECONDS = 15 * 60;

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
      lockedUip: boolean;
      lockedUser: boolean;
      inflightHeld: boolean;
      delayMs: number;
      uipFails: number;
      userFails: number;
      ipFails: number;
      username: string;
      ip: string;
    };

export function limiterKeyPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function userIpFailKey(username: string, ip: string): string {
  return userIpFailKeyHashed(limiterKeyPart(username), limiterKeyPart(ip));
}
export function userIpLockKey(username: string, ip: string): string {
  return userIpLockKeyHashed(limiterKeyPart(username), limiterKeyPart(ip));
}
/** B83 does not know past IPs, so it addresses the same keys through stored hashes. */
export function userIpFailKeyHashed(userHash: string, ipHash: string): string {
  return `login:fail:uip:${userHash}:${ipHash}`;
}
export function userIpLockKeyHashed(userHash: string, ipHash: string): string {
  return `login:lock:uip:${userHash}:${ipHash}`;
}
/* New key class: B83 has no IP, so it needs every IP hash that reserved for this username. */
export function uipIndexKey(username: string): string {
  return `login:uip:index:${limiterKeyPart(username)}`;
}
export function userFailKey(username: string): string {
  return `login:fail:user:${limiterKeyPart(username)}`;
}
export function userLockKey(username: string): string {
  return `login:lock:user:${limiterKeyPart(username)}`;
}
export function ipFailKey(ip: string): string {
  return `login:fail:ip:${limiterKeyPart(ip)}`;
}
export function tarpitKey(ip: string): string {
  return `login:tarpit:${limiterKeyPart(ip)}`;
}

/** LIM-C11-01 key class: per-sub (hashed account id), independent of username/IP keys. */
export function passwordChangeKey(accountId: string): string {
  return `pwd:change:sub:${limiterKeyPart(accountId)}`;
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
  // Plain SADD+EXPIRE keeps the existing reservation Lua untouched; best-effort, so an
  // index failure can never turn a reserved login into a 503.
  try {
    await redis.sadd(uipIndexKey(username), limiterKeyPart(ip));
    await redis.expire(uipIndexKey(username), LOGIN_USER_FAIL_WINDOW);
  } catch {
    /* the lock still works; only B83's IP fan-out is lost */
  }
  const reserved = {
    status: 'reserved' as const,
    lockedUip: asNumber(raw[1]) === 1,
    lockedUser: asNumber(raw[2]) === 1,
    locked: asNumber(raw[1]) === 1 || asNumber(raw[2]) === 1,
    uipFails: asNumber(raw[3]),
    userFails: asNumber(raw[4]),
    ipFails: asNumber(raw[5]),
    delayMs: 0,
    inflightHeld: false,
    username,
    ip,
  };
  const delay = tarpitDelaySeconds(reserved.ipFails, limits.tarpitAfter);
  if (delay <= 0) return reserved;
  const inflight = asNumber(
    await redis.eval(INCR_EXPIRE, 1, tarpitKey(ip), String(LOGIN_TARPIT_CAP_SECONDS)),
  );
  if (inflight > LOGIN_TARPIT_MAX_CONCURRENT) {
    await redis.eval(DECR_FLOOR, 1, tarpitKey(ip));
    return { status: 'blocked', retryAfter: delay };
  }
  return { ...reserved, delayMs: delay * 1000, inflightHeld: true };
}

/** AUTH-LG-04: success clears username counters and refunds the reserved IP increment. */
export async function settleLoginSuccess(
  redis: Redis,
  reservation: Extract<LoginReservation, { status: 'reserved' }>,
): Promise<void> {
  await redis.eval(
    SETTLE_SUCCESS,
    6,
    userIpFailKey(reservation.username, reservation.ip),
    userIpLockKey(reservation.username, reservation.ip),
    userFailKey(reservation.username),
    userLockKey(reservation.username),
    ipFailKey(reservation.ip),
    tarpitKey(reservation.ip),
    reservation.inflightHeld ? '1' : '0',
  );
}

/** Refund a reserved attempt that never ran verify (lookup/issue 503). */
export async function refundLoginAttempt(
  redis: Redis,
  reservation: Extract<LoginReservation, { status: 'reserved' }>,
): Promise<void> {
  await redis.eval(
    REFUND_ATTEMPT,
    6,
    userIpFailKey(reservation.username, reservation.ip),
    userIpLockKey(reservation.username, reservation.ip),
    userFailKey(reservation.username),
    userLockKey(reservation.username),
    ipFailKey(reservation.ip),
    tarpitKey(reservation.ip),
    reservation.lockedUip ? '1' : '0',
    reservation.lockedUser ? '1' : '0',
    reservation.inflightHeld ? '1' : '0',
  );
}

/** Drop tarpit inflight after a real verify failure (counts stay). */
export async function releaseLoginInflight(
  redis: Redis,
  reservation: Extract<LoginReservation, { status: 'reserved' }>,
): Promise<void> {
  if (!reservation.inflightHeld) return;
  await redis.eval(DECR_FLOOR, 1, tarpitKey(reservation.ip));
}

export async function applyLoginTarpit(
  reservation: Extract<LoginReservation, { status: 'reserved' }>,
  limits: LoginLimiterLimits = {},
): Promise<void> {
  if (reservation.delayMs <= 0) return;
  await (limits.sleep ?? defaultSleep)(reservation.delayMs);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * LIM-C11-01. Reuses the existing `INCR_EXPIRE` Lua (INCR + EXPIRE only on the first hit);
 * no new script is needed because this key class is a plain counter with a fixed window.
 */
export async function reservePasswordChangeAttempt(
  redis: Redis,
  accountId: string,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const key = passwordChangeKey(accountId);
  const count = asNumber(
    await redis.eval(INCR_EXPIRE, 1, key, String(PASSWORD_CHANGE_WINDOW_SECONDS)),
  );
  if (count <= PASSWORD_CHANGE_MAX_ATTEMPTS) return { allowed: true };
  const ttl = await redis.ttl(key);
  return { allowed: false, retryAfter: Math.max(ttl, 1) };
}

/** A completed change clears the per-sub counter, like a successful login clears its own. */
export async function clearPasswordChangeAttempts(redis: Redis, accountId: string): Promise<void> {
  await redis.del(passwordChangeKey(accountId));
}

/** LIM-B83-01: 10 unlocks per staff per hour, 3 per driver per hour. No-ops count. */
export const UNLOCK_STAFF_MAX_PER_HOUR = 10;
export const UNLOCK_DRIVER_MAX_PER_HOUR = 3;
export const UNLOCK_WINDOW_SECONDS = 3600;

export function unlockStaffKey(staffId: string): string {
  return `unlock:staff:${limiterKeyPart(staffId)}`;
}
export function unlockDriverKey(driverId: string): string {
  return `unlock:driver:${limiterKeyPart(driverId)}`;
}

export type UnlockReservation =
  { allowed: true; driverCount: number } | { allowed: false; retryAfter: number };

/** Reuses the shared `INCR_EXPIRE` script; no new Lua for a plain fixed-window counter. */
export async function reserveDriverUnlock(
  redis: Redis,
  staffId: string,
  driverId: string,
): Promise<UnlockReservation> {
  const staffKey = unlockStaffKey(staffId);
  const staffCount = asNumber(
    await redis.eval(INCR_EXPIRE, 1, staffKey, String(UNLOCK_WINDOW_SECONDS)),
  );
  if (staffCount > UNLOCK_STAFF_MAX_PER_HOUR) {
    return { allowed: false, retryAfter: Math.max(await redis.ttl(staffKey), 1) };
  }
  const driverKey = unlockDriverKey(driverId);
  const driverCount = asNumber(
    await redis.eval(INCR_EXPIRE, 1, driverKey, String(UNLOCK_WINDOW_SECONDS)),
  );
  if (driverCount > UNLOCK_DRIVER_MAX_PER_HOUR) {
    return { allowed: false, retryAfter: Math.max(await redis.ttl(driverKey), 1) };
  }
  return { allowed: true, driverCount };
}

/**
 * AUTH-B83-03: clear only username+IP and username-global counters and locks.
 * Never the per-IP counter, tarpit, or LIM-C11-01 `pwd:change:sub:*`.
 * Returns nothing; `driverLockedUntil` reads the pre-clear expiry for the response.
 */
export async function clearDriverLockout(redis: Redis, username: string): Promise<void> {
  const userHash = limiterKeyPart(username);
  const index = uipIndexKey(username);
  const ipHashes = await redis.smembers(index);
  const uip = ipHashes.flatMap((ipHash) => [
    userIpFailKeyHashed(userHash, ipHash),
    userIpLockKeyHashed(userHash, ipHash),
  ]);
  await redis.del(userFailKey(username), userLockKey(username), ...uip, index);
}

/** Max TTL of the username and username+IP *lock* keys; null when not locked. */
export async function driverLockedUntil(redis: Redis, username: string): Promise<Date | null> {
  const userHash = limiterKeyPart(username);
  const uip = (await redis.smembers(uipIndexKey(username))).map((ipHash) =>
    userIpLockKeyHashed(userHash, ipHash),
  );
  const ttls = await Promise.all([userLockKey(username), ...uip].map((key) => redis.ttl(key)));
  const maxTtl = Math.max(0, ...ttls.filter((ttl) => ttl > 0));
  return maxTtl > 0 ? new Date(Date.now() + maxTtl * 1000) : null;
}
