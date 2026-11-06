import { createHmac } from 'node:crypto';

/** AUTH-LG-01 / V11-O2-01. Over-long values are rejected, never truncated. */
export const USERNAME_MAX_CHARS = 64;
export const PASSWORD_MAX_BYTES = 128;

/** LIM-LG-01: 5 failures per (username, IP) / 15 min → 15 min block. */
export const LOGIN_FAILURES_TO_LOCK = 5;
export const LOGIN_LOCK_SECONDS = 15 * 60;

/** LIM-LG-02: per-username progressive backoff. Never permanent. */
export const LOGIN_BACKOFF_SECONDS = [60, 5 * 60, 15 * 60, 60 * 60] as const;

/** LIM-LG-03: 50 failures per IP / 15 min. Successes never count. */
export const LOGIN_IP_FAIL_LIMIT = 50;
export const LOGIN_IP_WINDOW_SECONDS = 15 * 60;

/** LIM-LG-04: tarpit after 20 IP failures, +1 s each, cap 10 s, max 5 concurrent. */
export const LOGIN_TARPIT_AFTER = 20;
export const LOGIN_TARPIT_CAP_SECONDS = 10;
export const LOGIN_TARPIT_MAX_CONCURRENT = 5;

/** AUTH-RT-05: a driver has ≤ 2 active families. */
export const DRIVER_MAX_SESSIONS = 2;

/** Dummy argon2id (m=19456,t=2,p=1) so a missing row still pays verify (9-10). */
export const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$nWMgUSiRSVjHbQH2ARANjw$VYaQXSFO+FTE33HNpPVjjP+8nArBtQ9dFowV21DROEY';

export function normalizeUsername(raw: string): string {
  return raw.trim().normalize('NFKC').toLowerCase();
}

export function usernameOverLong(normalized: string): boolean {
  return normalized.length > USERNAME_MAX_CHARS;
}

export function passwordOverLongBytes(raw: string): boolean {
  return Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX_BYTES;
}

/** Fixed HMAC key for tests (R13-2). Single source: `platform/config`. */
export { TEST_AUDIT_HASH_KEY } from '../../../platform/config.js';

/** R13-2: audit stores the username capped and HMAC-SHA256 hashed, never raw. */
export function hashUsernameForAudit(username: string, key: string): string {
  const capped = username.slice(0, USERNAME_MAX_CHARS);
  return createHmac('sha256', key).update(capped, 'utf8').digest('hex');
}

export function nextBackoffSeconds(userFailCount: number): number | null {
  if (userFailCount < LOGIN_FAILURES_TO_LOCK) return null;
  const stage = Math.min(
    Math.floor(userFailCount / LOGIN_FAILURES_TO_LOCK) - 1,
    LOGIN_BACKOFF_SECONDS.length - 1,
  );
  return LOGIN_BACKOFF_SECONDS[stage] ?? null;
}

export function tarpitDelaySeconds(ipFails: number, after = LOGIN_TARPIT_AFTER): number {
  if (ipFails <= after) return 0;
  return Math.min(ipFails - after, LOGIN_TARPIT_CAP_SECONDS);
}
