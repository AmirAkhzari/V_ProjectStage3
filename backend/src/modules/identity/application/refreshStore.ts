import type { Clock } from '../../../platform/lib/clock.js';
import type { SubjectType } from '../../../platform/auth/jwt.js';

export type RefreshRotateStatus = 'rotated' | 'grace' | 'rejected';

export type RefreshRejectReason =
  | 'unknown'
  | 'family_revoked'
  | 'typ_mismatch'
  | 'absolute_expired'
  | 'idle_expired'
  | 'reuse'
  | 'conflict'
  | 'lock_timeout';

export interface RefreshIssueInput {
  accountId: string;
  sid: string;
  familyId: string;
  typ: SubjectType;
  maxSessions?: number;
  distributorId?: string | null;
  requireActive?: boolean;
  /** Hash that login verified. Under the issue lock a mismatch aborts (R2-2 / R13-4). */
  verifiedPasswordHash?: string;
  casPasswordHash?: { oldHash: string; nextHash: string };
}

export interface RefreshIssueResult {
  refreshToken: string;
  hash: string;
  sid: string;
  familyId: string;
  typ: SubjectType;
  refreshExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RefreshRotateOk {
  status: 'rotated';
  refreshToken: string;
  hash: string;
  sid: string;
  familyId: string;
  typ: SubjectType;
  accountId: string;
  refreshExpiresAt: Date;
  absoluteExpiresAt: Date;
}

/** Amir 9-2: replay inside 20s returns access-only (same sid/family); no new refresh token. */
export interface RefreshRotateGrace {
  status: 'grace';
  sid: string;
  familyId: string;
  typ: SubjectType;
  accountId: string;
  absoluteExpiresAt: Date;
}

export interface RefreshRotateFail {
  status: 'rejected';
  reason: RefreshRejectReason;
}

export type RefreshRotateResult = RefreshRotateOk | RefreshRotateGrace | RefreshRotateFail;

export interface RefreshTokenRow {
  hash: string;
  familyId: string;
  sid: string;
  rotatedAt: Date | null;
  successor: string | null;
}

export interface RefreshTokenStore {
  issue(input: RefreshIssueInput, clock?: Clock): Promise<RefreshIssueResult>;
  rotate(presented: string, expectedTyp: SubjectType, clock?: Clock): Promise<RefreshRotateResult>;
}

export function isRefreshRejected(result: RefreshRotateResult): result is RefreshRotateFail {
  return result.status === 'rejected';
}
