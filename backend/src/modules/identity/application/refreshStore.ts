import type { Clock } from '../../../platform/lib/clock.js';
import type { SubjectType } from '../../../platform/auth/jwt.js';

export type RefreshRotateStatus = 'rotated' | 'grace' | 'rejected';

export type RefreshRejectReason =
  | 'unknown'
  | 'family_revoked'
  | 'typ_mismatch'
  | 'absolute_expired'
  | 'idle_expired'
  | 'inactive'
  | 'reuse'
  | 'conflict'
  | 'lock_timeout';

/** HTTP context for audit rows. Never carries a token or a hash. */
export interface RefreshCallContext {
  ip?: string | null;
  userAgent?: string | null;
  /** When false, a demo account RT is rejected with no write. */
  demoLogin?: boolean;
}

/** Server snapshot read inside the rotate transaction. Not taken from the presented RT. */
export interface RefreshSubjectProfile {
  phone: string;
  isNewAccount: boolean;
  staffRole: 'super_admin' | 'distributor_admin' | null;
  distributorId: string | null;
  permissions: string[];
  sessionVersion: number;
  isDemo: boolean;
}

export interface RefreshIssueInput {
  accountId: string;
  sid: string;
  familyId: string;
  typ: SubjectType;
  maxSessions?: number;
  distributorId?: string | null;
  requireActive?: boolean;
  /** N19-2: pre-lock staff snapshot; mismatch under the issue lock aborts. */
  expectedStaffRole?: string;
  expectedDistributorId?: string | null;
  /** Hash that login verified. Under the issue lock a mismatch aborts (R2-2 / R13-4). */
  verifiedPasswordHash?: string;
  casPasswordHash?: { oldHash: string; nextHash: string };
  /**
   * C11: the new session inherits the prior session's absolute window. `created_at` (and thus
   * the absolute expiry) is pinned to this instant instead of `now`.
   */
  authTime?: Date;
  /** C11: runs after locks/CAS but BEFORE the new session/RT INSERT (revoke prior families). */
  beforeInsert?: IssueTxHook;
  /** N18-5: run inside the issue transaction before COMMIT (OTP login audit). */
  beforeCommit?: IssueTxHook;
}

export type IssueTxHook = (client: {
  query: (queryText: string, values?: unknown[]) => Promise<unknown>;
}) => Promise<void>;

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
  profile?: RefreshSubjectProfile;
}

/** Amir 9-2: replay inside 20s returns access-only (same sid/family); no new refresh token. */
export interface RefreshRotateGrace {
  status: 'grace';
  sid: string;
  familyId: string;
  typ: SubjectType;
  accountId: string;
  absoluteExpiresAt: Date;
  profile?: RefreshSubjectProfile;
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
  rotate(
    presented: string,
    expectedTyp: SubjectType,
    clock?: Clock,
    context?: RefreshCallContext,
  ): Promise<RefreshRotateResult>;
  /** A4: revoke the presented token's family when typ matches. Same 200 either way. */
  logoutPresented(
    presented: string,
    expectedTyp: SubjectType,
    clock?: Clock,
    context?: RefreshCallContext,
  ): Promise<{ revoked: boolean }>;
  /** B4/C3: revoke the family of this sid. Does not touch other families. */
  logoutSid(
    sid: string,
    expectedTyp: SubjectType,
    clock?: Clock,
    context?: RefreshCallContext,
  ): Promise<{ revoked: boolean }>;
}

export function isRefreshRejected(result: RefreshRotateResult): result is RefreshRotateFail {
  return result.status === 'rejected';
}
