import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import { markAccountInactive } from '../infra/session/pgSessionStore.js';
import { revokeSubjectSessions } from './revokeSessions.js';
import type pg from 'pg';

export async function deactivateAccount(
  pool: pg.Pool,
  authority: SessionAuthority,
  accountId: string,
): Promise<{ sids: string[] }> {
  await markAccountInactive(pool, accountId);
  return revokeSubjectSessions(pool, authority, { accountId, reason: 'deactivated' });
}
