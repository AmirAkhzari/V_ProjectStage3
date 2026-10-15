import { randomUUID } from 'node:crypto';
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
import {
  REFRESH_GRACE_AUDIT_ACTION,
  REFRESH_REUSE_AUDIT_ACTION,
  sessionsRevokedEvent,
} from '../../events.js';
import { generateRefreshToken, hashRefreshToken } from './refreshHash.js';

interface LockedRefreshRow {
  hash: string;
  family_id: string;
  sid: string;
  rotated_at: Date | null;
  successor: string | null;
  used_at: Date | null;
  grace_used_at: Date | null;
  typ: string;
  created_at: Date;
  last_used_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  account_id: string;
}

/**
 * Postgres refresh-token store. Writes hashes only (AUTH-RT-05). Revocation is UPDATE,
 * never DELETE (AppSec 7-1 / AUTH-RT-02). Rotate / issue / revokeFamily are one transaction
 * (AppSec 9-1): SELECT FOR UPDATE + UPDATE WHERE rotated_at IS NULL.
 */
export class PgRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly pool: pg.Pool) {}

  async issue(input: RefreshIssueInput, clock: Clock = systemClock): Promise<RefreshIssueResult> {
    const now = clock();
    const windows = sessionWindows(input.typ, now, now);
    const refreshToken = generateRefreshToken();
    const hash = hashRefreshToken(refreshToken);
    await this.withTx(async (client) => {
      await client.query(
        `INSERT INTO identity.sessions
           (sid, account_id, typ, family_id, created_at, last_used_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6)`,
        [input.sid, input.accountId, input.typ, input.familyId, now, windows.absoluteExpiresAt],
      );
      await client.query(
        `INSERT INTO identity.refresh_tokens
           (hash, family_id, sid, rotated_at, successor, used_at, grace_used_at)
         VALUES ($1, $2, $3, NULL, NULL, NULL, NULL)`,
        [hash, input.familyId, input.sid],
      );
    });
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
    return this.withTx(async (client) => {
      const locked = await tryRefreshAdvisoryLock(client, hash);
      if (!locked) return { status: 'rejected', reason: 'conflict' };

      const found = await client.query<LockedRefreshRow>(
        `SELECT t.hash, t.family_id, t.sid, t.rotated_at, t.successor, t.used_at, t.grace_used_at,
                s.typ, s.created_at, s.last_used_at, s.absolute_expires_at, s.revoked_at, s.account_id
           FROM identity.refresh_tokens t
           JOIN identity.sessions s ON s.sid = t.sid
          WHERE t.hash = $1
          FOR UPDATE OF t, s`,
        [hash],
      );
      const row = found.rows[0];
      if (!row) return { status: 'rejected', reason: 'unknown' };

      if (row.rotated_at !== null) {
        return this.replayRotated(client, row, expectedTyp, now);
      }

      if (row.revoked_at !== null) return { status: 'rejected', reason: 'family_revoked' };
      if (row.typ !== expectedTyp) return { status: 'rejected', reason: 'typ_mismatch' };
      if (isAbsoluteExpired(row.typ as SubjectType, row.created_at, now)) {
        return { status: 'rejected', reason: 'absolute_expired' };
      }
      if (isIdleExpired(row.typ as SubjectType, row.created_at, row.last_used_at, now)) {
        return { status: 'rejected', reason: 'idle_expired' };
      }

      return this.claimRotation(client, row, now);
    });
  }

  private async replayRotated(
    client: pg.PoolClient,
    row: LockedRefreshRow,
    expectedTyp: SubjectType,
    now: Date,
  ): Promise<RefreshRotateResult> {
    if (row.revoked_at !== null) return { status: 'rejected', reason: 'family_revoked' };
    if (row.rotated_at === null) return { status: 'rejected', reason: 'unknown' };
    const typ = row.typ as SubjectType;
    const age = now.getTime() - row.rotated_at.getTime();
    const successorUnused = await this.successorUnused(client, row.successor);
    const graceOpen =
      age <= REFRESH_GRACE_MS &&
      row.grace_used_at === null &&
      successorUnused &&
      row.revoked_at === null &&
      typ === expectedTyp &&
      !isAbsoluteExpired(typ, row.created_at, now) &&
      !isIdleExpired(typ, row.created_at, row.last_used_at, now);

    if (graceOpen) {
      const claimed = await client.query(
        `UPDATE identity.refresh_tokens
            SET grace_used_at = $2
          WHERE hash = $1 AND grace_used_at IS NULL AND rotated_at IS NOT NULL`,
        [row.hash, now],
      );
      if (claimed.rowCount === 1) {
        await insertAudit(client, {
          accountId: row.account_id,
          action: REFRESH_GRACE_AUDIT_ACTION,
          familyId: row.family_id,
          sid: row.sid,
          now,
        });
        return {
          status: 'grace',
          sid: row.sid,
          familyId: row.family_id,
          typ,
          accountId: row.account_id,
        };
      }
    }

    await this.revokeFamilyInTx(client, {
      familyId: row.family_id,
      sid: row.sid,
      accountId: row.account_id,
      now,
    });
    return { status: 'rejected', reason: 'reuse' };
  }

  private async claimRotation(
    client: pg.PoolClient,
    row: LockedRefreshRow,
    now: Date,
  ): Promise<RefreshRotateResult> {
    const nextToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextToken);
    const typ = row.typ as SubjectType;
    const windows = sessionWindows(typ, row.created_at, now);
    const cas = await client.query(
      `UPDATE identity.refresh_tokens
          SET rotated_at = $2, used_at = $2, successor = $3
        WHERE hash = $1 AND rotated_at IS NULL`,
      [row.hash, now, nextHash],
    );
    if (cas.rowCount !== 1) return { status: 'rejected', reason: 'conflict' };
    await client.query(
      `INSERT INTO identity.refresh_tokens
         (hash, family_id, sid, rotated_at, successor, used_at, grace_used_at)
       VALUES ($1, $2, $3, NULL, NULL, NULL, NULL)`,
      [nextHash, row.family_id, row.sid],
    );
    await client.query(`UPDATE identity.sessions SET last_used_at = $2 WHERE sid = $1`, [
      row.sid,
      now,
    ]);
    return {
      status: 'rotated',
      refreshToken: nextToken,
      hash: nextHash,
      sid: row.sid,
      familyId: row.family_id,
      typ,
      accountId: row.account_id,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    };
  }

  private async successorUnused(client: pg.PoolClient, successor: string | null): Promise<boolean> {
    if (successor === null) return false;
    const found = await client.query<{ used_at: Date | null; rotated_at: Date | null }>(
      `SELECT used_at, rotated_at FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`,
      [successor],
    );
    const next = found.rows[0];
    return next !== undefined && next.used_at === null && next.rotated_at === null;
  }

  private async revokeFamilyInTx(
    client: pg.PoolClient,
    input: { familyId: string; sid: string; accountId: string; now: Date },
  ): Promise<void> {
    await client.query(
      `UPDATE identity.sessions
          SET revoked_at = $2, revoke_reason = 'refresh_reuse'
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [input.familyId, input.now],
    );
    await client.query(
      `UPDATE identity.refresh_tokens
          SET rotated_at = COALESCE(rotated_at, $2), used_at = COALESCE(used_at, $2)
        WHERE family_id = $1`,
      [input.familyId, input.now],
    );
    await insertAudit(client, {
      accountId: input.accountId,
      action: REFRESH_REUSE_AUDIT_ACTION,
      familyId: input.familyId,
      sid: input.sid,
      now: input.now,
    });
    const event = sessionsRevokedEvent(
      {
        familyId: input.familyId,
        sid: input.sid,
        accountId: input.accountId,
        reason: 'refresh_reuse',
      },
      input.now,
    );
    await client.query(
      `INSERT INTO platform.outbox_events (
         id, event_type, event_version, aggregate_type, aggregate_id, distributor_id,
         payload, occurred_at, attempts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
      [
        event.id,
        event.type,
        event.version,
        event.aggregateType,
        event.aggregateId,
        event.distributorId,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
  }

  private async withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

async function tryRefreshAdvisoryLock(client: pg.PoolClient, hash: string): Promise<boolean> {
  const result = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
    `SELECT pg_try_advisory_xact_lock(
       ('x' || substr($1, 1, 8))::bit(32)::int,
       ('x' || substr($1, 9, 8))::bit(32)::int
     )`,
    [hash],
  );
  return result.rows[0]?.pg_try_advisory_xact_lock === true;
}

async function insertAudit(
  client: pg.PoolClient,
  input: { accountId: string; action: string; familyId: string; sid: string; now: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.audit_log (
       id, at, actor_type, actor_id, actor_name, distributor_id,
       action, entity, entity_id, data, ip
     ) VALUES ($1, $2, 'system', $3, 'identity', NULL, $4, 'session', $5, $6, NULL)`,
    [
      randomUUID(),
      input.now,
      input.accountId,
      input.action,
      input.familyId,
      JSON.stringify({ sid: input.sid, familyId: input.familyId, reason: input.action }),
    ],
  );
}
