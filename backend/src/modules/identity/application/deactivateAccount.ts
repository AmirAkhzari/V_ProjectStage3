import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import {
  deactivateAccountAtomic,
  drainPendingDenies,
  type DrainLog,
} from '../infra/session/pgSessionStore.js';
import type pg from 'pg';

export async function deactivateAccount(
  pool: pg.Pool,
  authority: SessionAuthority,
  accountId: string,
  log?: DrainLog,
): Promise<{ sids: string[] }> {
  const revoked = await deactivateAccountAtomic(pool, { accountId });
  if (revoked.sids.length > 0) {
    await drainPendingDenies(pool, (sids) => authority.deny(sids), log);
  }
  return { sids: revoked.sids };
}
