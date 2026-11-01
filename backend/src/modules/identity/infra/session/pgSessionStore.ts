import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { SubjectType } from '../../../../platform/auth/jwt.js';
import type { SessionReader, SessionSnapshot } from '../../../../platform/auth/sessionAuthority.js';
import { permissionsForRole, type StaffRole } from '../../domain/permissions.js';
import {
  SESSIONS_REVOKED_EVENT,
  SESSIONS_REVOKED_EVENT_VERSION,
  type SessionRevokeReason,
} from '../../events.js';

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
    return {
      sid: row.sid,
      accountId: row.account_id,
      typ: row.typ as SubjectType,
      familyId: row.family_id,
      sessionVersion: row.session_version,
      accountStatus: row.account_status === 'inactive' ? 'inactive' : 'active',
      revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
      distributorId: row.distributor_id,
      staffRole,
      permissions: staffRole ? [...permissionsForRole(staffRole, row.permissions ?? [])] : [],
      mustChangePassword: row.must_change_password,
    };
  }
}

export async function revokeAccountSessions(
  pool: pg.Pool,
  input: { accountId: string; reason: SessionRevokeReason; now?: Date },
): Promise<{ sids: string[]; familyIds: string[] }> {
  const now = input.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessions = await client.query<{ sid: string; family_id: string }>(
      `SELECT sid, family_id FROM identity.sessions
        WHERE account_id = $1 AND revoked_at IS NULL
        FOR UPDATE`,
      [input.accountId],
    );
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
    await client.query('COMMIT');
    return { sids: sessions.rows.map((row) => row.sid), familyIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markAccountInactive(pool: pg.Pool, accountId: string): Promise<void> {
  await pool.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [accountId]);
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
  return status === 'inactive' ? 'inactive' : 'active';
}

function asStaffRole(value: string | null): StaffRole | null {
  if (value === 'super_admin' || value === 'distributor_admin') return value;
  return null;
}
