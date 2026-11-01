import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import { deactivateAccountAtomic, drainPendingDenies } from '../infra/session/pgSessionStore.js';
import type pg from 'pg';

export async function deactivateAccount(
  pool: pg.Pool,
  authority: SessionAuthority,
  accountId: string,
): Promise<{ sids: string[] }> {
  const revoked = await deactivateAccountAtomic(pool, { accountId });
  if (revoked.sids.length > 0) {
    await drainPendingDenies(pool, (sids) => authority.deny(sids));
  }
  return { sids: revoked.sids };
}
