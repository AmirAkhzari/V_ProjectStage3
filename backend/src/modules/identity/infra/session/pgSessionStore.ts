import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { SubjectType } from '../../../../platform/auth/jwt.js';
import type { SessionReader, SessionSnapshot } from '../../../../platform/auth/sessionAuthority.js';
import { demoDaPermissions, permissionList } from '../../domain/demoAccounts.js';
import { permissionsForRole, type StaffRole } from '../../domain/permissions.js';
import {
  SESSIONS_REVOKED_EVENT,
  SESSIONS_REVOKED_EVENT_VERSION,
  type SessionRevokeReason,
} from '../../events.js';
import {
  applyLockTimeout,
  lockSessionsThenTokensThenAccount,
  withRetryableTx,
} from './lockOrder.js';

interface LookupRow {
  sid: string;
  account_id: string;
  typ: string;
  family_id: string;
  revoked_at: Date | null;
  session_version: number;
  account_status: string;
  distributor_id: string | null;
  staff_role: string | null;
  permissions: string[] | null;
  must_change_password: boolean;
}

export class PgSessionStore implements SessionReader {
  constructor(private readonly pool: pg.Pool) {}

  async lookup(sid: string): Promise<SessionSnapshot | null> {
    const found = await this.pool.query<LookupRow>(
      `SELECT sid, account_id, typ, family_id, revoked_at, session_version,
              account_status, distributor_id, staff_role, permissions, must_change_password
         FROM identity.lookup_session($1)`,
      [sid],
    );
    const row = found.rows[0];
    if (!row) return null;
    const staffRole = asStaffRole(row.staff_role);
    let permissions = staffRole
      ? [...permissionsForRole(staffRole, permissionList(row.permissions))]
      : [];
    if (staffRole) {
      const demo = await this.pool.query<{ is_demo: boolean }>(
        `SELECT is_demo FROM identity.accounts WHERE id = $1`,
        [row.account_id],
      );
      if (demo.rows[0]?.is_demo === true) permissions = demoDaPermissions(permissions);
    }
    return {
      sid: row.sid,
      accountId: row.account_id,
      typ: row.typ as SubjectType,
      familyId: row.family_id,
      sessionVersion: row.session_version,
      accountStatus: row.account_status === 'active' ? 'active' : 'inactive',
      revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
      distributorId: row.distributor_id,
      staffRole,
      permissions,
      mustChangePassword: row.must_change_password,
    };
  }
}

export async function revokeAccountSessions(
  pool: pg.Pool,
  input: {
    accountId: string;
    reason: SessionRevokeReason;
    now?: Date;
    lockTimeout?: string;
    onLockRetry?: () => void;
  },
): Promise<{ sids: string[]; familyIds: string[]; lockRetries: number }> {
  const { value, lockRetries } = await withRetryableTx(
    pool,
    (client) => revokeAccountSessionsInTx(client, input),
    input.onLockRetry,
  );
  return { ...value, lockRetries };
}

export async function deactivateAccountAtomic(
  pool: pg.Pool,
  input: { accountId: string; now?: Date; lockTimeout?: string; onLockRetry?: () => void },
): Promise<{ sids: string[]; familyIds: string[]; lockRetries: number }> {
  const { value, lockRetries } = await withRetryableTx(
    pool,
    async (client) => {
      await applyLockTimeout(client, input.lockTimeout);
      await lockSessionsThenTokensThenAccount(client, {
        kind: 'account',
        accountId: input.accountId,
        lockAccount: true,
      });
      await client.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [
        input.accountId,
      ]);
      return revokeAccountSessionsInTx(client, {
        accountId: input.accountId,
        reason: 'deactivated',
        alreadyLocked: true,
        ...(input.now ? { now: input.now } : {}),
        ...(input.lockTimeout ? { lockTimeout: input.lockTimeout } : {}),
      });
    },
    input.onLockRetry,
  );
  return { ...value, lockRetries };
}

export async function lookupAccountStatus(
  pool: pg.Pool,
  accountId: string,
): Promise<'active' | 'inactive' | null> {
  const found = await pool.query<{ status: string }>(
    `SELECT status FROM identity.accounts WHERE id = $1`,
    [accountId],
  );
  const status = found.rows[0]?.status;
  if (status === undefined) return null;
  return status === 'active' ? 'active' : 'inactive';
}

async function revokeAccountSessionsInTx(
  client: pg.PoolClient,
  input: {
    accountId: string;
    reason: SessionRevokeReason;
    now?: Date;
    lockTimeout?: string;
    alreadyLocked?: boolean;
  },
): Promise<{ sids: string[]; familyIds: string[] }> {
  const now = input.now ?? new Date();
  if (!input.alreadyLocked) {
    await applyLockTimeout(client, input.lockTimeout);
    await lockSessionsThenTokensThenAccount(client, {
      kind: 'account',
      accountId: input.accountId,
      lockAccount: true,
    });
  }
  const sessions = await client.query<{ sid: string; family_id: string }>(
    `SELECT sid, family_id FROM identity.sessions
      WHERE account_id = $1 AND revoked_at IS NULL
      ORDER BY sid`,
    [input.accountId],
  );
  const sids = sessions.rows.map((row) => row.sid);
  await client.query(
    `UPDATE identity.sessions
        SET revoked_at = $2, revoke_reason = $3
      WHERE account_id = $1 AND revoked_at IS NULL`,
    [input.accountId, now, input.reason],
  );
  await client.query(
    `UPDATE identity.refresh_tokens t
        SET rotated_at = COALESCE(t.rotated_at, $2), used_at = COALESCE(t.used_at, $2)
       FROM identity.sessions s
      WHERE s.sid = t.sid AND s.account_id = $1`,
    [input.accountId, now],
  );
  await client.query(
    `UPDATE identity.accounts SET session_version = session_version + 1 WHERE id = $1`,
    [input.accountId],
  );
  const distributor = await client.query<{ distributor_id: string | null }>(
    `SELECT distributor_id FROM identity.lookup_account_scope($1)`,
    [input.accountId],
  );
  const distributorId = distributor.rows[0]?.distributor_id ?? null;
  const familyIds = [...new Set(sessions.rows.map((row) => row.family_id))];
  await enqueuePendingDenies(client, sids, now);
  for (const familyId of familyIds) {
    const sid = sessions.rows.find((row) => row.family_id === familyId)?.sid ?? familyId;
    await client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, $2, 'system', $3, 'identity', $4, $5, 'session', $6, $7, NULL)`,
      [
        randomUUID(),
        now,
        input.accountId,
        distributorId,
        input.reason,
        familyId,
        JSON.stringify({ sid, familyId, reason: input.reason }),
      ],
    );
    await client.query(
      `INSERT INTO platform.outbox_events (
         id, event_type, event_version, aggregate_type, aggregate_id, distributor_id,
         payload, occurred_at, attempts
       ) VALUES ($1, $2, $3, 'session', $4, $5, $6, $7, 0)`,
      [
        randomUUID(),
        SESSIONS_REVOKED_EVENT,
        SESSIONS_REVOKED_EVENT_VERSION,
        familyId,
        distributorId,
        JSON.stringify({
          familyId,
          sid,
          accountId: input.accountId,
          reason: input.reason,
        }),
        now,
      ],
    );
  }
  return { sids, familyIds };
}

export async function enqueuePendingDenies(
  client: pg.PoolClient,
  sids: readonly string[],
  now: Date,
): Promise<void> {
  for (const sid of sids) {
    await client.query(
      `INSERT INTO identity.pending_session_denies (sid, enqueued_at, attempts)
       VALUES ($1, $2, 0)
       ON CONFLICT (sid) DO UPDATE
         SET enqueued_at = EXCLUDED.enqueued_at,
             attempts = 0,
             last_error = NULL,
             done_at = NULL`,
      [sid, now],
    );
  }
}

export async function listOpenPendingDenies(pool: pg.Pool, maxAttempts = 3): Promise<string[]> {
  const found = await pool.query<{ sid: string }>(
    `SELECT sid FROM identity.pending_session_denies
      WHERE done_at IS NULL AND attempts < $1
      ORDER BY enqueued_at`,
    [maxAttempts],
  );
  return found.rows.map((row) => row.sid);
}

export async function markPendingDeniesDone(pool: pg.Pool, sids: readonly string[]): Promise<void> {
  if (sids.length === 0) return;
  await pool.query(
    `UPDATE identity.pending_session_denies
        SET done_at = now()
      WHERE sid = ANY($1::uuid[]) AND done_at IS NULL`,
    [sids],
  );
}

export async function markPendingDenyAttempt(
  pool: pg.Pool,
  sids: readonly string[],
  error: unknown,
): Promise<void> {
  if (sids.length === 0) return;
  const message = error instanceof Error ? error.message : 'deny failed';
  await pool.query(
    `UPDATE identity.pending_session_denies
        SET attempts = attempts + 1, last_error = $2
      WHERE sid = ANY($1::uuid[]) AND done_at IS NULL`,
    [sids, message],
  );
}

export interface DrainLog {
  error(bindings: Record<string, unknown>, message: string): void;
  warn?(bindings: Record<string, unknown>, message: string): void;
  info?(bindings: Record<string, unknown>, message: string): void;
}

export const silentDrainLog: DrainLog = {
  error() {},
  warn() {},
};

/** R12-10: revoke one session with no session_version bump. */
export async function revokeSessionsBySid(
  pool: pg.Pool,
  input: { sids: readonly string[]; reason: SessionRevokeReason; now?: Date },
): Promise<string[]> {
  if (input.sids.length === 0) return [];
  const { value } = await withRetryableTx(pool, async (client) => {
    await applyLockTimeout(client);
    await lockSessionsThenTokensThenAccount(client, { kind: 'sids', sids: input.sids });
    const now = input.now ?? new Date();
    await enqueuePendingDenies(client, input.sids, now);
    await client.query(
      `UPDATE identity.sessions SET revoked_at = $2, revoke_reason = $3
        WHERE sid = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [input.sids, now, input.reason],
    );
    await client.query(
      `UPDATE identity.refresh_tokens SET rotated_at = COALESCE(rotated_at, $2), used_at = COALESCE(used_at, $2)
        WHERE sid = ANY($1::uuid[])`,
      [input.sids, now],
    );
    return [...input.sids];
  });
  return value;
}

function publicError(error: unknown): { name: string; code?: string } {
  const name = error instanceof Error ? error.name : 'Error';
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  return code === undefined ? { name } : { name, code };
}

/** Drain the durable deny outbox with bounded retries (A-11-1 / N12-2). Never throws. */
export async function drainPendingDenies(
  pool: pg.Pool,
  deny: (sids: readonly string[]) => Promise<void>,
  log: DrainLog,
): Promise<void> {
  try {
    const sids = await listOpenPendingDenies(pool);
    if (sids.length === 0) return;
    try {
      await deny(sids);
      await markPendingDeniesDone(pool, sids);
    } catch (error) {
      try {
        await markPendingDenyAttempt(pool, sids, error);
      } catch (markError) {
        log.error({ err: publicError(markError) }, 'pending deny mark failed');
      }
    }
  } catch (error) {
    log.error({ err: publicError(error) }, 'pending deny drain failed');
  }
}

function asStaffRole(value: string | null): StaffRole | null {
  if (value === 'super_admin' || value === 'distributor_admin') return value;
  return null;
}
