import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Clock } from '../../../../platform/lib/clock.js';
import { systemClock } from '../../../../platform/lib/clock.js';
import type { SubjectType } from '../../../../platform/auth/jwt.js';
import {
  REFRESH_GRACE_MS,
  REFRESH_LOCK_TIMEOUT,
  isAbsoluteExpired,
  isIdleExpired,
  sessionWindows,
} from '../../domain/sessionTtl.js';
import { demoDaPermissions } from '../../domain/demoAccounts.js';
import { permissionsForRole, type StaffRole } from '../../domain/permissions.js';
import type {
  RefreshCallContext,
  RefreshIssueInput,
  RefreshIssueResult,
  RefreshRotateResult,
  RefreshSubjectProfile,
  RefreshTokenStore,
} from '../../application/refreshStore.js';
import {
  REFRESH_GRACE_AUDIT_ACTION,
  REFRESH_REUSE_AUDIT_ACTION,
  sessionsRevokedEvent,
  type SessionRevokeReason,
} from '../../events.js';
import {
  applyLockTimeout,
  isRetryableLockError,
  lockSessionsThenTokensThenAccount,
} from '../session/lockOrder.js';
import {
  drainPendingDenies,
  enqueuePendingDenies,
  silentDrainLog,
  type DrainLog,
} from '../session/pgSessionStore.js';
import { generateRefreshToken, hashRefreshToken } from './refreshHash.js';

export interface RefreshStoreHooks {
  onSidsRevoked: (sids: readonly string[]) => Promise<void>;
  log: DrainLog;
}

function requiredOnSidsRevoked(): Promise<void> {
  return Promise.reject(new Error('onSidsRevoked is required'));
}

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
 * (AppSec 9-1 / arch §7.1.1): blocking SELECT FOR UPDATE + SET LOCAL lock_timeout='2s'
 * for unused-token waiters and grace/replay waiters alike. 55P03 → retryable
 * lock_timeout, no state change. No pg_try_advisory_xact_lock.
 */
export class PgRefreshTokenStore implements RefreshTokenStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly hooks: RefreshStoreHooks = {
      onSidsRevoked: requiredOnSidsRevoked,
      log: silentDrainLog,
    },
  ) {}

  async issue(input: RefreshIssueInput, clock: Clock = systemClock): Promise<RefreshIssueResult> {
    const now = clock();
    const windows = sessionWindows(input.typ, now, now);
    const refreshToken = generateRefreshToken();
    const hash = hashRefreshToken(refreshToken);
    const extraSids = await this.withTx(async (client) => {
      await applyLockTimeout(client);
      await lockSessionsThenTokensThenAccount(client, {
        kind: 'account',
        accountId: input.accountId,
        lockAccount: true,
      });
      if (input.verifiedPasswordHash || input.casPasswordHash) {
        if (input.distributorId) {
          await client.query('SELECT set_config($1, $2, true)', [
            'app.distributor_id',
            input.distributorId,
          ]);
        }
        await client.query('SELECT set_config($1, $2, true)', ['app.subject_type', 'driver']);
        const current = await client.query<{ status: string; password_hash: string }>(
          `SELECT a.status, c.password_hash
             FROM identity.accounts a
             JOIN identity.driver_credentials c ON c.account_id = a.id
            WHERE a.id = $1`,
          [input.accountId],
        );
        const row = current.rows[0];
        if (!row || (input.requireActive && row.status !== 'active')) {
          throw Object.assign(new Error('inactive'), { code: 'ISSUE_ABORTED' });
        }
        if (input.verifiedPasswordHash && row.password_hash !== input.verifiedPasswordHash) {
          throw Object.assign(new Error('hash changed'), { code: 'ISSUE_ABORTED' });
        }
        if (input.casPasswordHash && row.password_hash === input.casPasswordHash.oldHash) {
          await client.query(
            `UPDATE identity.driver_credentials SET password_hash = $2
              WHERE account_id = $1 AND password_hash = $3`,
            [input.accountId, input.casPasswordHash.nextHash, input.casPasswordHash.oldHash],
          );
        }
      } else if (input.requireActive) {
        const current = await client.query<{ status: string }>(
          `SELECT status FROM identity.accounts WHERE id = $1`,
          [input.accountId],
        );
        const row = current.rows[0];
        if (!row || row.status !== 'active') {
          throw Object.assign(new Error('inactive'), { code: 'ISSUE_ABORTED' });
        }
        if (input.typ === 'staff') {
          const membership = await client.query<{
            role: string;
            distributor_id: string | null;
            distributor_status: string | null;
          }>(
            `SELECT role, distributor_id, distributor_status FROM identity.staff_otp_membership($1)`,
            [input.accountId],
          );
          const mem = membership.rows[0];
          if (
            membership.rows.length !== 1 ||
            !mem ||
            (mem.role !== 'super_admin' && mem.role !== 'distributor_admin') ||
            (mem.role === 'super_admin' && mem.distributor_id) ||
            (mem.role === 'distributor_admin' && !mem.distributor_id) ||
            (input.expectedStaffRole !== undefined && mem.role !== input.expectedStaffRole) ||
            (input.expectedDistributorId !== undefined &&
              mem.distributor_id !== input.expectedDistributorId) ||
            (mem.role === 'distributor_admin' && mem.distributor_status !== 'active')
          ) {
            throw Object.assign(new Error('membership'), { code: 'ISSUE_ABORTED' });
          }
        }
      }
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
      if (input.beforeCommit) await input.beforeCommit(client);
      return this.revokeOverflowInTx(client, input, now);
    });
    if (extraSids.length > 0) {
      await drainPendingDenies(this.pool, (sids) => this.hooks.onSidsRevoked(sids), this.hooks.log);
    }
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
    context: RefreshCallContext = {},
  ): Promise<RefreshRotateResult> {
    const now = clock();
    const hash = hashRefreshToken(presented);
    try {
      const outcome = await this.withTx(async (client) => {
        await applyLockTimeout(client, REFRESH_LOCK_TIMEOUT);
        const peeked = await client.query<{ family_id: string }>(
          `SELECT t.family_id
             FROM identity.refresh_tokens t
            WHERE t.hash = $1`,
          [hash],
        );
        const familyId = peeked.rows[0]?.family_id;
        if (familyId) {
          await lockSessionsThenTokensThenAccount(client, { kind: 'family', familyId });
        }
        const found = await client.query<LockedRefreshRow>(
          `SELECT t.hash, t.family_id, t.sid, t.rotated_at, t.successor, t.used_at, t.grace_used_at,
                s.typ, s.created_at, s.last_used_at, s.absolute_expires_at, s.revoked_at, s.account_id
           FROM identity.sessions s
           JOIN identity.refresh_tokens t ON t.sid = s.sid
          WHERE t.hash = $1
          ORDER BY s.sid, t.hash`,
          [hash],
        );
        const row = found.rows[0];
        if (!row) return { result: { status: 'rejected' as const, reason: 'unknown' as const } };
        if (await this.demoRefreshBlocked(client, row.account_id, context)) {
          return { result: { status: 'rejected' as const, reason: 'inactive' as const } };
        }

        if (row.typ !== expectedTyp) {
          await insertAudit(client, {
            accountId: row.account_id,
            action: 'refresh_typ_mismatch',
            familyId: row.family_id,
            sid: row.sid,
            now,
            distributorId: await lookupDistributorId(client, row.account_id),
            ip: context.ip,
            userAgent: context.userAgent,
            actualTyp: row.typ,
          });
          return { result: { status: 'rejected' as const, reason: 'typ_mismatch' as const } };
        }
        if (row.rotated_at !== null) {
          return this.replayRotated(client, row, expectedTyp, now, context);
        }

        if (row.revoked_at !== null) {
          return { result: { status: 'rejected' as const, reason: 'family_revoked' as const } };
        }
        if (isAbsoluteExpired(row.typ as SubjectType, row.created_at, now)) {
          return { result: { status: 'rejected' as const, reason: 'absolute_expired' as const } };
        }
        if (isIdleExpired(row.typ as SubjectType, row.created_at, row.last_used_at, now)) {
          return { result: { status: 'rejected' as const, reason: 'idle_expired' as const } };
        }
        const profile = await this.subjectProfile(client, row);
        if (row.typ !== 'driver' && !profile) {
          return { result: { status: 'rejected' as const, reason: 'inactive' as const } };
        }
        return { result: await this.claimRotation(client, row, now, profile ?? undefined) };
      });
      if (outcome.revokedSids && outcome.revokedSids.length > 0) {
        await drainPendingDenies(
          this.pool,
          (sids) => this.hooks.onSidsRevoked(sids),
          this.hooks.log,
        );
      }
      return outcome.result;
    } catch (error) {
      if (isRetryableLockError(error)) return { status: 'rejected', reason: 'lock_timeout' };
      throw error;
    }
  }

  private async replayRotated(
    client: pg.PoolClient,
    row: LockedRefreshRow,
    expectedTyp: SubjectType,
    now: Date,
    context: RefreshCallContext,
  ): Promise<{ result: RefreshRotateResult; revokedSids?: string[] }> {
    if (row.revoked_at !== null) {
      return { result: { status: 'rejected', reason: 'family_revoked' } };
    }
    if (row.rotated_at === null) return { result: { status: 'rejected', reason: 'unknown' } };
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
      const profile = await this.subjectProfile(client, row);
      if (row.typ !== 'driver' && !profile) {
        return { result: { status: 'rejected', reason: 'inactive' } };
      }
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
          distributorId: await lookupDistributorId(client, row.account_id),
          ip: context.ip,
          userAgent: context.userAgent,
        });
        return {
          result: {
            status: 'grace',
            sid: row.sid,
            familyId: row.family_id,
            typ,
            accountId: row.account_id,
            absoluteExpiresAt: row.absolute_expires_at,
            ...(profile ? { profile } : {}),
          },
        };
      }
    }

    const revokedSids = await this.revokeFamilyInTx(client, {
      familyId: row.family_id,
      sid: row.sid,
      accountId: row.account_id,
      now,
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { result: { status: 'rejected', reason: 'reuse' }, revokedSids };
  }

  private async claimRotation(
    client: pg.PoolClient,
    row: LockedRefreshRow,
    now: Date,
    profile?: RefreshSubjectProfile,
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
      ...(profile ? { profile } : {}),
    };
  }

  async logoutPresented(
    presented: string,
    expectedTyp: SubjectType,
    clock: Clock = systemClock,
    context: RefreshCallContext = {},
  ): Promise<{ revoked: boolean }> {
    const now = clock();
    const hash = hashRefreshToken(presented);
    const outcome = await this.withTx(async (client) => {
      await applyLockTimeout(client, REFRESH_LOCK_TIMEOUT);
      const peeked = await client.query<{ family_id: string }>(
        `SELECT family_id FROM identity.refresh_tokens WHERE hash = $1`,
        [hash],
      );
      const familyId = peeked.rows[0]?.family_id;
      if (!familyId) return [] as string[];
      await lockSessionsThenTokensThenAccount(client, { kind: 'family', familyId });
      const found = await client.query<{
        typ: string;
        sid: string;
        account_id: string;
        open: boolean;
        rotated_at: Date | null;
      }>(
        `SELECT s.typ, s.sid, s.account_id, (s.revoked_at IS NULL) AS open, t.rotated_at
           FROM identity.sessions s
           JOIN identity.refresh_tokens t ON t.sid = s.sid
          WHERE t.hash = $1`,
        [hash],
      );
      const row = found.rows[0];
      if (!row || row.typ !== expectedTyp || !row.open) return [] as string[];
      return this.revokeFamilyInTx(client, {
        familyId,
        sid: row.sid,
        accountId: row.account_id,
        now,
        reason: row.rotated_at ? 'refresh_reuse' : 'logout',
        ip: context.ip,
        userAgent: context.userAgent,
      });
    });
    if (outcome.length > 0) {
      // Drain overlaps the A4 response floor. A failure leaves the pending row (AUTH-RV-01).
      void drainPendingDenies(this.pool, (sids) => this.hooks.onSidsRevoked(sids), this.hooks.log);
    }
    return { revoked: outcome.length > 0 };
  }

  async logoutSid(
    sid: string,
    expectedTyp: SubjectType,
    clock: Clock = systemClock,
    context: RefreshCallContext = {},
  ): Promise<{ revoked: boolean }> {
    const now = clock();
    const outcome = await this.withTx(async (client) => {
      await applyLockTimeout(client, REFRESH_LOCK_TIMEOUT);
      const peeked = await client.query<{ family_id: string }>(
        `SELECT family_id FROM identity.sessions WHERE sid = $1`,
        [sid],
      );
      const familyId = peeked.rows[0]?.family_id;
      if (!familyId) return [] as string[];
      await lockSessionsThenTokensThenAccount(client, { kind: 'family', familyId });
      const found = await client.query<{
        typ: string;
        sid: string;
        account_id: string;
        open: boolean;
      }>(
        `SELECT typ, sid, account_id, (revoked_at IS NULL) AS open
           FROM identity.sessions WHERE sid = $1`,
        [sid],
      );
      const row = found.rows[0];
      if (!row || row.typ !== expectedTyp || !row.open) return [] as string[];
      return this.revokeFamilyInTx(client, {
        familyId,
        sid: row.sid,
        accountId: row.account_id,
        now,
        reason: 'logout',
        ip: context.ip,
        userAgent: context.userAgent,
      });
    });
    if (outcome.length > 0) {
      await drainPendingDenies(this.pool, (sids) => this.hooks.onSidsRevoked(sids), this.hooks.log);
    }
    return { revoked: outcome.length > 0 };
  }

  /** Shopkeeper/staff eligibility under the account lock. Driver is unchanged (null). */
  private async subjectProfile(
    client: pg.PoolClient,
    row: LockedRefreshRow,
  ): Promise<RefreshSubjectProfile | null> {
    if (row.typ === 'driver') return null;
    await client.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [
      row.account_id,
    ]);
    const account = await client.query<{
      status: string;
      phone: string | null;
      session_version: number;
      is_demo: boolean;
    }>(`SELECT status, phone, session_version, is_demo FROM identity.accounts WHERE id = $1`, [
      row.account_id,
    ]);
    const acc = account.rows[0];
    if (!acc || acc.status !== 'active' || !acc.phone) return null;
    if (row.typ === 'shopkeeper') {
      return {
        phone: acc.phone,
        isNewAccount: false,
        staffRole: null,
        distributorId: null,
        permissions: [],
        sessionVersion: acc.session_version,
        isDemo: acc.is_demo,
      };
    }
    const membership = await client.query<{
      role: string;
      distributor_id: string | null;
      distributor_status: string | null;
    }>(`SELECT role, distributor_id, distributor_status FROM identity.staff_otp_membership($1)`, [
      row.account_id,
    ]);
    if (membership.rows.length !== 1) return null;
    const mem = membership.rows[0];
    const role =
      mem && (mem.role === 'super_admin' || mem.role === 'distributor_admin') ? mem.role : null;
    if (!mem || !role) return null;
    if (role === 'super_admin' && mem.distributor_id) return null;
    if (
      role === 'distributor_admin' &&
      (!mem.distributor_id || mem.distributor_status !== 'active')
    ) {
      return null;
    }
    const stored = await client.query<{ permissions: string[] | null }>(
      `SELECT permissions FROM identity.staff_memberships
        WHERE account_id = $1 AND role = $2`,
      [row.account_id, role],
    );
    const issued = [
      ...new Set(permissionsForRole(role as StaffRole, stored.rows[0]?.permissions ?? [])),
    ];
    return {
      phone: acc.phone,
      isNewAccount: false,
      staffRole: role,
      distributorId: mem.distributor_id,
      permissions: acc.is_demo ? demoDaPermissions(issued) : issued,
      sessionVersion: acc.session_version,
      isDemo: acc.is_demo,
    };
  }

  /** Demo RT with the flag off: 401 and no rotation, grace mark, or revoke. */
  private async demoRefreshBlocked(
    client: pg.PoolClient,
    accountId: string,
    context: RefreshCallContext,
  ): Promise<boolean> {
    const found = await client.query<{ is_demo: boolean }>(
      `SELECT is_demo FROM identity.accounts WHERE id = $1`,
      [accountId],
    );
    return found.rows[0]?.is_demo === true && context.demoLogin !== true;
  }

  private async revokeOverflowInTx(
    client: pg.PoolClient,
    input: RefreshIssueInput,
    now: Date,
  ): Promise<string[]> {
    const cap = input.maxSessions;
    if (cap === undefined || cap < 1) return [];
    const open = await client.query<{ sid: string; family_id: string }>(
      `SELECT sid, family_id FROM identity.sessions
        WHERE account_id = $1 AND revoked_at IS NULL
        ORDER BY created_at, sid`,
      [input.accountId],
    );
    const overflow = Math.max(0, open.rows.length - cap);
    const victims = open.rows.filter((row) => row.sid !== input.sid).slice(0, overflow);
    if (victims.length === 0) return [];
    const sids = victims.map((row) => row.sid);
    await enqueuePendingDenies(client, sids, now);
    await client.query(
      `UPDATE identity.sessions SET revoked_at = $2, revoke_reason = 'session_limit'
        WHERE sid = ANY($1::uuid[])`,
      [sids, now],
    );
    await client.query(
      `UPDATE identity.refresh_tokens SET rotated_at = COALESCE(rotated_at, $2), used_at = COALESCE(used_at, $2)
        WHERE sid = ANY($1::uuid[])`,
      [sids, now],
    );
    const distributorId =
      input.distributorId ?? (await lookupDistributorId(client, input.accountId));
    for (const victim of victims) {
      await insertAudit(client, {
        accountId: input.accountId,
        action: 'session_limit',
        familyId: victim.family_id,
        sid: victim.sid,
        now,
        distributorId,
      });
      const event = sessionsRevokedEvent(
        {
          familyId: victim.family_id,
          sid: victim.sid,
          accountId: input.accountId,
          reason: 'session_limit',
        },
        now,
        distributorId,
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
    return sids;
  }

  private async successorUnused(client: pg.PoolClient, successor: string | null): Promise<boolean> {
    if (successor === null) return false;
    const found = await client.query<{ used_at: Date | null; rotated_at: Date | null }>(
      `SELECT used_at, rotated_at FROM identity.refresh_tokens WHERE hash = $1`,
      [successor],
    );
    const next = found.rows[0];
    return next !== undefined && next.used_at === null && next.rotated_at === null;
  }

  private async revokeFamilyInTx(
    client: pg.PoolClient,
    input: {
      familyId: string;
      sid: string;
      accountId: string;
      now: Date;
      reason?: SessionRevokeReason;
      ip?: string | null | undefined;
      userAgent?: string | null | undefined;
    },
  ): Promise<string[]> {
    const locked = await lockSessionsThenTokensThenAccount(client, {
      kind: 'family',
      familyId: input.familyId,
    });
    const revokedSids = locked.map((row) => row.sid);
    await enqueuePendingDenies(client, revokedSids, input.now);
    const reason = input.reason ?? 'refresh_reuse';
    const action = reason === 'refresh_reuse' ? REFRESH_REUSE_AUDIT_ACTION : reason;
    await client.query(
      `UPDATE identity.sessions
          SET revoked_at = $2, revoke_reason = $3
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [input.familyId, input.now, reason],
    );
    await client.query(
      `UPDATE identity.refresh_tokens
          SET rotated_at = COALESCE(rotated_at, $2), used_at = COALESCE(used_at, $2)
        WHERE family_id = $1`,
      [input.familyId, input.now],
    );
    const distributorId = await lookupDistributorId(client, input.accountId);
    await insertAudit(client, {
      accountId: input.accountId,
      action,
      familyId: input.familyId,
      sid: input.sid,
      now: input.now,
      distributorId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    const event = sessionsRevokedEvent(
      {
        familyId: input.familyId,
        sid: input.sid,
        accountId: input.accountId,
        reason,
      },
      input.now,
      distributorId,
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
    return revokedSids;
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

async function lookupDistributorId(
  client: pg.PoolClient,
  accountId: string,
): Promise<string | null> {
  const found = await client.query<{ distributor_id: string | null }>(
    `SELECT distributor_id FROM identity.lookup_account_scope($1)`,
    [accountId],
  );
  return found.rows[0]?.distributor_id ?? null;
}

async function insertAudit(
  client: pg.PoolClient,
  input: {
    accountId: string;
    action: string;
    familyId: string;
    sid: string;
    now: Date;
    distributorId?: string | null;
    ip?: string | null | undefined;
    userAgent?: string | null | undefined;
    actualTyp?: string;
  },
): Promise<void> {
  const data: Record<string, string> = {
    sid: input.sid,
    familyId: input.familyId,
    reason: input.action,
  };
  if (input.userAgent) data['ua'] = input.userAgent.slice(0, 200);
  if (input.actualTyp) data['actualTyp'] = input.actualTyp;
  await client.query(
    `INSERT INTO platform.audit_log (
       id, at, actor_type, actor_id, actor_name, distributor_id,
       action, entity, entity_id, data, ip
     ) VALUES ($1, $2, 'system', $3, 'identity', $7, $4, 'session', $5, $6, $8)`,
    [
      randomUUID(),
      input.now,
      input.accountId,
      input.action,
      input.familyId,
      JSON.stringify(data),
      input.distributorId ?? null,
      input.ip ?? null,
    ],
  );
}
