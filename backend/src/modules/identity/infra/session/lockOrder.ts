import type pg from 'pg';

/** N12-1: every path locks sessions (sid ASC), then tokens (hash ASC), then the account.
 * F13-4: account-scope locks only non-revoked rows; family/sid scopes still lock all. */
export const IDENTITY_LOCK_TIMEOUT = '2s';

export interface LockedSessionRow {
  sid: string;
  family_id: string;
  account_id: string;
}

export type IdentityLockScope =
  | { kind: 'account'; accountId: string; lockAccount: boolean }
  | { kind: 'family'; familyId: string }
  | { kind: 'sids'; sids: readonly string[] };

export async function applyLockTimeout(
  client: pg.PoolClient,
  timeout: string = IDENTITY_LOCK_TIMEOUT,
): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', ['lock_timeout', timeout]);
}

/**
 * Shared lock order for rotate, family revoke, account revoke/logout-all, and deactivate.
 * Never lock the account before sessions and tokens.
 */
export async function lockSessionsThenTokensThenAccount(
  client: pg.PoolClient,
  scope: IdentityLockScope,
): Promise<LockedSessionRow[]> {
  const sessions = await lockSessions(client, scope);
  const sids = sessions.map((row) => row.sid);
  if (sids.length > 0) {
    await client.query(
      `SELECT hash FROM identity.refresh_tokens
        WHERE sid = ANY($1::uuid[])
        ORDER BY hash
        FOR UPDATE`,
      [sids],
    );
  }
  if (scope.kind === 'account' && scope.lockAccount) {
    await client.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [
      scope.accountId,
    ]);
  }
  return sessions;
}

async function lockSessions(
  client: pg.PoolClient,
  scope: IdentityLockScope,
): Promise<LockedSessionRow[]> {
  if (scope.kind === 'account') {
    const found = await client.query<LockedSessionRow>(
      `SELECT sid, family_id, account_id FROM identity.sessions
        WHERE account_id = $1 AND revoked_at IS NULL
        ORDER BY sid
        FOR UPDATE`,
      [scope.accountId],
    );
    return found.rows;
  }
  if (scope.kind === 'family') {
    const found = await client.query<LockedSessionRow>(
      `SELECT sid, family_id, account_id FROM identity.sessions
        WHERE family_id = $1
        ORDER BY sid
        FOR UPDATE`,
      [scope.familyId],
    );
    return found.rows;
  }
  if (scope.sids.length === 0) return [];
  const found = await client.query<LockedSessionRow>(
    `SELECT sid, family_id, account_id FROM identity.sessions
      WHERE sid = ANY($1::uuid[])
      ORDER BY sid
      FOR UPDATE`,
    [scope.sids],
  );
  return found.rows;
}

export function isRetryableLockError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;
  return (
    code === '55P03' ||
    code === '40P01' ||
    (typeof message === 'string' && /lock timeout|deadlock detected/i.test(message))
  );
}

export async function withRetryableTx<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  onLockRetry?: () => void,
): Promise<{ value: T; lockRetries: number }> {
  let lastError: unknown;
  let lockRetries = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return { value, lockRetries };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      lastError = error;
      if (!isRetryableLockError(error) || attempt === 1) throw error;
      lockRetries += 1;
      onLockRetry?.();
    } finally {
      client.release();
    }
  }
  throw lastError;
}
