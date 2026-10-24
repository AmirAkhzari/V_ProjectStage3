import type { Clock } from '../../../../platform/lib/clock.js';
import { systemClock } from '../../../../platform/lib/clock.js';
import type { AuditEntry } from '../../../../platform/audit/audit.js';
import type { EventEnvelope } from '../../../../platform/events/envelope.js';
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
import {
  REFRESH_GRACE_AUDIT_ACTION,
  REFRESH_REUSE_AUDIT_ACTION,
  sessionsRevokedEvent,
} from '../../events.js';
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
  usedAt: Date | null;
  graceUsedAt: Date | null;
}

/** In-memory AUTH-RT store. Persistence of hashes (not plaintext) is AUTH-RT-05. */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly sessions = new Map<string, SessionRow>();
  readonly tokens = new Map<string, TokenRow>();
  readonly audits: AuditEntry[] = [];
  readonly events: EventEnvelope[] = [];
  private readonly queues = new Map<string, Promise<void>>();

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
      usedAt: null,
      graceUsedAt: null,
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
    const hash = hashRefreshToken(presented);
    const previous = this.queues.get(hash) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(hash, gate);
    return previous.then(() => this.rotateLocked(presented, expectedTyp, clock)).finally(release);
  }

  peek(hash: string): TokenRow | undefined {
    return this.tokens.get(hash);
  }

  plaintextTokens(): string[] {
    return [];
  }

  private rotateLocked(
    presented: string,
    expectedTyp: SubjectType,
    clock: Clock,
  ): RefreshRotateResult {
    const now = clock();
    const hash = hashRefreshToken(presented);
    const token = this.tokens.get(hash);
    if (!token) return { status: 'rejected', reason: 'unknown' };
    const session = this.sessions.get(token.sid);
    if (!session) return { status: 'rejected', reason: 'unknown' };

    if (token.rotatedAt !== null) {
      return this.replayRotated(session, token, expectedTyp, now);
    }

    if (session.revokedAt !== null) return { status: 'rejected', reason: 'family_revoked' };
    if (session.typ !== expectedTyp) return { status: 'rejected', reason: 'typ_mismatch' };
    if (isAbsoluteExpired(session.typ, session.createdAt, now)) {
      return { status: 'rejected', reason: 'absolute_expired' };
    }
    if (isIdleExpired(session.typ, session.createdAt, session.lastUsedAt, now)) {
      return { status: 'rejected', reason: 'idle_expired' };
    }

    return this.claimRotation(session, token, now);
  }

  private replayRotated(
    session: SessionRow,
    token: TokenRow,
    expectedTyp: SubjectType,
    now: Date,
  ): RefreshRotateResult {
    if (session.revokedAt !== null) return { status: 'rejected', reason: 'family_revoked' };
    const rotatedAt = token.rotatedAt;
    if (rotatedAt === null) return { status: 'rejected', reason: 'unknown' };
    const age = now.getTime() - rotatedAt.getTime();
    const successor = token.successor === null ? undefined : this.tokens.get(token.successor);
    const successorUnused =
      successor !== undefined && successor.usedAt === null && successor.rotatedAt === null;
    const graceOpen =
      age <= REFRESH_GRACE_MS &&
      token.graceUsedAt === null &&
      successorUnused &&
      session.revokedAt === null &&
      session.typ === expectedTyp &&
      !isAbsoluteExpired(session.typ, session.createdAt, now) &&
      !isIdleExpired(session.typ, session.createdAt, session.lastUsedAt, now);

    if (graceOpen) {
      token.graceUsedAt = now;
      this.audits.push(graceAudit(session));
      return {
        status: 'grace',
        sid: session.sid,
        familyId: session.familyId,
        typ: session.typ,
        accountId: session.accountId,
      };
    }

    this.revokeFamily(token.familyId, now);
    return { status: 'rejected', reason: 'reuse' };
  }

  private claimRotation(session: SessionRow, current: TokenRow, now: Date): RefreshRotateResult {
    const nextToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextToken);
    current.rotatedAt = now;
    current.usedAt = now;
    current.successor = nextHash;
    this.tokens.set(nextHash, {
      hash: nextHash,
      familyId: current.familyId,
      sid: current.sid,
      rotatedAt: null,
      successor: null,
      usedAt: null,
      graceUsedAt: null,
    });
    session.lastUsedAt = now;
    const windows = sessionWindows(session.typ, session.createdAt, now);
    return {
      status: 'rotated',
      refreshToken: nextToken,
      hash: nextHash,
      sid: session.sid,
      familyId: session.familyId,
      typ: session.typ,
      accountId: session.accountId,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    };
  }

  private revokeFamily(familyId: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId && session.revokedAt === null) {
        session.revokedAt = now;
        this.audits.push(reuseAudit(session));
        this.events.push(
          sessionsRevokedEvent(
            {
              familyId,
              sid: session.sid,
              accountId: session.accountId,
              reason: 'refresh_reuse',
            },
            now,
          ),
        );
      }
    }
    for (const token of this.tokens.values()) {
      if (token.familyId === familyId) {
        token.rotatedAt ??= now;
        token.usedAt ??= now;
      }
    }
  }
}

function graceAudit(session: SessionRow): AuditEntry {
  return {
    actorType: 'system',
    actorId: session.accountId,
    actorName: 'identity',
    distributorId: null,
    action: REFRESH_GRACE_AUDIT_ACTION,
    entity: 'session',
    entityId: session.familyId,
    data: { sid: session.sid, familyId: session.familyId, reason: REFRESH_GRACE_AUDIT_ACTION },
    ip: null,
  };
}

function reuseAudit(session: SessionRow): AuditEntry {
  return {
    actorType: 'system',
    actorId: session.accountId,
    actorName: 'identity',
    distributorId: null,
    action: REFRESH_REUSE_AUDIT_ACTION,
    entity: 'session',
    entityId: session.familyId,
    data: { sid: session.sid, familyId: session.familyId, reason: REFRESH_REUSE_AUDIT_ACTION },
    ip: null,
  };
}
