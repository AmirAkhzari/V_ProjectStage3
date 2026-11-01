import type { SubjectType } from '../../../platform/auth/jwt.js';

/** AUTH-RT-02 / Amir 9-2: one access-only replay within 20s; reuse after that revokes the family. */
export const REFRESH_GRACE_MS = 20_000;

/** AppSec G5: blocking FOR UPDATE wait; then retryable lock_timeout, no state change. */
export const REFRESH_LOCK_TIMEOUT = '2s';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * AUTH-RT-03 / DECISION_LOG §I defaults. Driver 10h absolute: DL-13 / 2026-10-14
 * (Amir re-confirmed 2026-11-01). Config may only shorten these caps.
 */
export const SESSION_TTL = {
  shopkeeper: { absoluteMs: 90 * DAY_MS, idleMs: 30 * DAY_MS },
  staff: { absoluteMs: 7 * DAY_MS, idleMs: 12 * HOUR_MS },
  driver: { absoluteMs: 10 * HOUR_MS, idleMs: null },
} as const;

export interface SessionTtlOverrides {
  shopkeeperAbsoluteMs?: number;
  shopkeeperIdleMs?: number;
  staffAbsoluteMs?: number;
  staffIdleMs?: number;
  driverAbsoluteMs?: number;
}

let ttlOverrides: SessionTtlOverrides = {};

export function configureSessionTtl(overrides: SessionTtlOverrides): void {
  if (
    overrides.shopkeeperAbsoluteMs !== undefined &&
    overrides.shopkeeperAbsoluteMs > SESSION_TTL.shopkeeper.absoluteMs
  ) {
    throw new Error('SESSION_TTL shopkeeper absolute may only shorten the 90d policy cap');
  }
  if (
    overrides.shopkeeperIdleMs !== undefined &&
    overrides.shopkeeperIdleMs > SESSION_TTL.shopkeeper.idleMs
  ) {
    throw new Error('SESSION_TTL shopkeeper sliding may only shorten the 30d policy cap');
  }
  if (
    overrides.staffAbsoluteMs !== undefined &&
    overrides.staffAbsoluteMs > SESSION_TTL.staff.absoluteMs
  ) {
    throw new Error('SESSION_TTL staff absolute may only shorten the 7d policy cap');
  }
  if (overrides.staffIdleMs !== undefined && overrides.staffIdleMs > SESSION_TTL.staff.idleMs) {
    throw new Error('SESSION_TTL staff idle may only shorten the 12h policy cap');
  }
  if (
    overrides.driverAbsoluteMs !== undefined &&
    overrides.driverAbsoluteMs > SESSION_TTL.driver.absoluteMs
  ) {
    throw new Error('SESSION_TTL driver absolute may only shorten the 10h policy cap');
  }
  ttlOverrides = overrides;
}

export function sessionTtlMs(typ: SubjectType): { absoluteMs: number; idleMs: number | null } {
  if (typ === 'shopkeeper') {
    return {
      absoluteMs: ttlOverrides.shopkeeperAbsoluteMs ?? SESSION_TTL.shopkeeper.absoluteMs,
      idleMs: ttlOverrides.shopkeeperIdleMs ?? SESSION_TTL.shopkeeper.idleMs,
    };
  }
  if (typ === 'staff') {
    return {
      absoluteMs: ttlOverrides.staffAbsoluteMs ?? SESSION_TTL.staff.absoluteMs,
      idleMs: ttlOverrides.staffIdleMs ?? SESSION_TTL.staff.idleMs,
    };
  }
  return {
    absoluteMs: ttlOverrides.driverAbsoluteMs ?? SESSION_TTL.driver.absoluteMs,
    idleMs: null,
  };
}

export interface SessionWindows {
  absoluteExpiresAt: Date;
  refreshExpiresAt: Date;
}

export function absoluteExpiresAt(typ: SubjectType, createdAt: Date): Date {
  return new Date(createdAt.getTime() + sessionTtlMs(typ).absoluteMs);
}

export function refreshExpiresAt(typ: SubjectType, createdAt: Date, now: Date): Date {
  const absolute = absoluteExpiresAt(typ, createdAt);
  const idleMs = sessionTtlMs(typ).idleMs;
  if (idleMs === null) return absolute;
  const sliding = new Date(now.getTime() + idleMs);
  return sliding.getTime() < absolute.getTime() ? sliding : absolute;
}

export function sessionWindows(typ: SubjectType, createdAt: Date, now: Date): SessionWindows {
  return {
    absoluteExpiresAt: absoluteExpiresAt(typ, createdAt),
    refreshExpiresAt: refreshExpiresAt(typ, createdAt, now),
  };
}

export function isAbsoluteExpired(typ: SubjectType, createdAt: Date, now: Date): boolean {
  return now.getTime() >= absoluteExpiresAt(typ, createdAt).getTime();
}

export function isIdleExpired(
  typ: SubjectType,
  createdAt: Date,
  lastUsedAt: Date,
  now: Date,
): boolean {
  if (isAbsoluteExpired(typ, createdAt, now)) return true;
  const idleMs = sessionTtlMs(typ).idleMs;
  if (idleMs === null) return false;
  return now.getTime() >= lastUsedAt.getTime() + idleMs;
}
