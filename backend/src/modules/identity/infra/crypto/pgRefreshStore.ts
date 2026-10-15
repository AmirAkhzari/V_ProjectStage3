import type pg from 'pg';
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

/**
 * Postgres refresh-token store. Writes hashes only (AUTH-RT-05). Revocation is UPDATE,
 * never DELETE (AppSec 7-1 / AUTH-RT-02).
 */
export class PgRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly pool: pg.Pool) {}

  async issue(input: RefreshIssueInput, clock: Clock = systemClock): Promise<RefreshIssueResult> {
    const now = clock();
    const windows = sessionWindows(input.typ, now, now);
    const refreshToken = generateRefreshToken();
    const hash = hashRefreshToken(refreshToken);
    await this.pool.query(
      `INSERT INTO identity.sessions
         (sid, account_id, typ, family_id, created_at, last_used_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      [input.sid, input.accountId, input.typ, input.familyId, now, windows.absoluteExpiresAt],
    );
    await this.pool.query(
      `INSERT INTO identity.refresh_tokens (hash, family_id, sid, rotated_at, successor)
       VALUES ($1, $2, $3, NULL, NULL)`,
      [hash, input.familyId, input.sid],
    );
    return {
      refreshToken,
      hash,
      sid: input.sid,
      familyId: input.familyId,
      typ: input.typ,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    };
  }

  async rotate(
    presented: string,
    expectedTyp: SubjectType,
    clock: Clock = systemClock,
  ): Promise<RefreshRotateResult> {
    const now = clock();
    const hash = hashRefreshToken(presented);
    const found = await this.pool.query<{
      hash: string;
      family_id: string;
      sid: string;
      rotated_at: Date | null;
      successor: string | null;
      typ: string;
      created_at: Date;
      last_used_at: Date;
      absolute_expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT t.hash, t.family_id, t.sid, t.rotated_at, t.successor,
              s.typ, s.created_at, s.last_used_at, s.absolute_expires_at, s.revoked_at
         FROM identity.refresh_tokens t
         JOIN identity.sessions s ON s.sid = t.sid
        WHERE t.hash = $1`,
      [hash],
    );
    const row = found.rows[0];
    if (!row) return { status: 'rejected', reason: 'unknown' };
    if (row.typ !== expectedTyp) return { status: 'rejected', reason: 'typ_mismatch' };
    if (row.revoked_at !== null) return { status: 'rejected', reason: 'family_revoked' };
    if (isAbsoluteExpired(row.typ as SubjectType, row.created_at, now)) {
      return { status: 'rejected', reason: 'absolute_expired' };
    }
    if (isIdleExpired(row.typ as SubjectType, row.created_at, row.last_used_at, now)) {
      return { status: 'rejected', reason: 'idle_expired' };
    }

    if (row.rotated_at !== null) {
      const age = now.getTime() - row.rotated_at.getTime();
      if (age > REFRESH_GRACE_MS) {
        await this.revokeFamily(row.family_id, now);
        return { status: 'rejected', reason: 'reuse' };
      }
      return this.persistRotation(row, now, 'grace');
    }
    return this.persistRotation(row, now, 'rotated');
  }

  private async persistRotation(
    row: { hash: string; family_id: string; sid: string; typ: string; created_at: Date },
    now: Date,
    status: 'rotated' | 'grace',
  ): Promise<RefreshRotateResult> {
    const nextToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextToken);
    const typ = row.typ as SubjectType;
    const windows = sessionWindows(typ, row.created_at, now);
    await this.pool.query(
      `UPDATE identity.refresh_tokens
          SET rotated_at = COALESCE(rotated_at, $2), successor = $3
        WHERE hash = $1`,
      [row.hash, now, nextHash],
    );
    await this.pool.query(
      `INSERT INTO identity.refresh_tokens (hash, family_id, sid, rotated_at, successor)
       VALUES ($1, $2, $3, NULL, NULL)`,
      [nextHash, row.family_id, row.sid],
    );
    await this.pool.query(`UPDATE identity.sessions SET last_used_at = $2 WHERE sid = $1`, [
      row.sid,
      now,
    ]);
    return {
      status,
      refreshToken: nextToken,
      hash: nextHash,
      sid: row.sid,
      familyId: row.family_id,
      typ,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    };
  }

  private async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE identity.sessions
          SET revoked_at = $2, revoke_reason = 'refresh_reuse'
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId, now],
    );
    await this.pool.query(
      `UPDATE identity.refresh_tokens
          SET rotated_at = COALESCE(rotated_at, $2)
        WHERE family_id = $1`,
      [familyId, now],
    );
  }
}
