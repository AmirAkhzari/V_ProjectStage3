import type { SubjectType } from '../../../platform/auth/jwt.js';

/** AUTH-RT-02 / Amir 9-2: one access-only replay within 20s; reuse after that revokes the family. */
export const REFRESH_GRACE_MS = 20_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** AUTH-RT-03 / DECISION_LOG §I. Driver absolute is 10h exactly; refresh never extends it. */
export const SESSION_TTL = {
  shopkeeper: { absoluteMs: 90 * DAY_MS, idleMs: 30 * DAY_MS },
  staff: { absoluteMs: 7 * DAY_MS, idleMs: 12 * HOUR_MS },
  driver: { absoluteMs: 10 * HOUR_MS, idleMs: null },
} as const;

export interface SessionWindows {
  absoluteExpiresAt: Date;
  refreshExpiresAt: Date;
}

export function absoluteExpiresAt(typ: SubjectType, createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_TTL[typ].absoluteMs);
}

export function refreshExpiresAt(typ: SubjectType, createdAt: Date, now: Date): Date {
  const absolute = absoluteExpiresAt(typ, createdAt);
  const idleMs = SESSION_TTL[typ].idleMs;
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
  const idleMs = SESSION_TTL[typ].idleMs;
  if (idleMs === null) return false;
  return now.getTime() >= lastUsedAt.getTime() + idleMs;
}
