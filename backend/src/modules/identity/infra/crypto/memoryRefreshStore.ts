import type { Clock } from '../../../../platform/lib/clock.js';
import { systemClock } from '../../../../platform/lib/clock.js';
import type { SubjectType } from '../../../../platform/auth/jwt.js';
import {
  REFRESH_GRACE_MS,
  isAbsoluteExpired,
  isIdleExpired,
  sessionWindows,
} from '../../domain/sessionTtl.js';
import type {
  RefreshIssueInput,
  RefreshIssueResult,
  RefreshRotateResult,
  RefreshTokenStore,
} from '../../application/refreshStore.js';
import { generateRefreshToken, hashRefreshToken } from './refreshHash.js';

interface SessionRow {
  sid: string;
  accountId: string;
  typ: SubjectType;
  familyId: string;
  createdAt: Date;
  lastUsedAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

interface TokenRow {
  hash: string;
  familyId: string;
  sid: string;
  rotatedAt: Date | null;
  successor: string | null;
}

/** In-memory AUTH-RT store. Persistence of hashes (not plaintext) is AUTH-RT-05. */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly sessions = new Map<string, SessionRow>();
  readonly tokens = new Map<string, TokenRow>();

  issue(input: RefreshIssueInput, clock: Clock = systemClock): Promise<RefreshIssueResult> {
    const now = clock();
    const windows = sessionWindows(input.typ, now, now);
    const refreshToken = generateRefreshToken();
    const hash = hashRefreshToken(refreshToken);
    this.sessions.set(input.sid, {
      sid: input.sid,
      accountId: input.accountId,
      typ: input.typ,
      familyId: input.familyId,
      createdAt: now,
      lastUsedAt: now,
      absoluteExpiresAt: windows.absoluteExpiresAt,
      revokedAt: null,
    });
    this.tokens.set(hash, {
      hash,
      familyId: input.familyId,
      sid: input.sid,
      rotatedAt: null,
      successor: null,
    });
    return Promise.resolve({
      refreshToken,
      hash,
      sid: input.sid,
      familyId: input.familyId,
      typ: input.typ,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    });
  }

  rotate(
    presented: string,
    expectedTyp: SubjectType,
    clock: Clock = systemClock,
  ): Promise<RefreshRotateResult> {
    const now = clock();
    const hash = hashRefreshToken(presented);
    const token = this.tokens.get(hash);
    if (!token) {
      return Promise.resolve({ status: 'rejected', reason: 'unknown' });
    }
    const session = this.sessions.get(token.sid);
    if (!session) {
      return Promise.resolve({ status: 'rejected', reason: 'unknown' });
    }
    if (session.typ !== expectedTyp) {
      return Promise.resolve({ status: 'rejected', reason: 'typ_mismatch' });
    }
    if (session.revokedAt !== null) {
      return Promise.resolve({ status: 'rejected', reason: 'family_revoked' });
    }
    if (isAbsoluteExpired(session.typ, session.createdAt, now)) {
      return Promise.resolve({ status: 'rejected', reason: 'absolute_expired' });
    }
    if (isIdleExpired(session.typ, session.createdAt, session.lastUsedAt, now)) {
      return Promise.resolve({ status: 'rejected', reason: 'idle_expired' });
    }

    if (token.rotatedAt !== null) {
      const age = now.getTime() - token.rotatedAt.getTime();
      if (age > REFRESH_GRACE_MS) {
        this.revokeFamily(token.familyId, now);
        return Promise.resolve({ status: 'rejected', reason: 'reuse' });
      }
      return Promise.resolve(this.rotateFrom(session, token, now, 'grace'));
    }

    return Promise.resolve(this.rotateFrom(session, token, now, 'rotated'));
  }

  peek(hash: string): TokenRow | undefined {
    return this.tokens.get(hash);
  }

  plaintextTokens(): string[] {
    return [];
  }

  private rotateFrom(
    session: SessionRow,
    current: TokenRow,
    now: Date,
    status: 'rotated' | 'grace',
  ): RefreshRotateResult {
    const nextToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextToken);
    if (current.rotatedAt === null) current.rotatedAt = now;
    current.successor = nextHash;
    this.tokens.set(nextHash, {
      hash: nextHash,
      familyId: current.familyId,
      sid: current.sid,
      rotatedAt: null,
      successor: null,
    });
    session.lastUsedAt = now;
    const windows = sessionWindows(session.typ, session.createdAt, now);
    return {
      status,
      refreshToken: nextToken,
      hash: nextHash,
      sid: session.sid,
      familyId: session.familyId,
      typ: session.typ,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    };
  }

  private revokeFamily(familyId: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId && session.revokedAt === null) {
        session.revokedAt = now;
      }
    }
    for (const token of this.tokens.values()) {
      if (token.familyId === familyId && token.rotatedAt === null) {
        token.rotatedAt = now;
      }
    }
  }
}
