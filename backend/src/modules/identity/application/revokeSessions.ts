import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import type { SessionRevokeReason } from '../events.js';
import {
  drainPendingDenies,
  revokeAccountSessions,
  type DrainLog,
} from '../infra/session/pgSessionStore.js';
import type pg from 'pg';

export async function revokeSubjectSessions(
  pool: pg.Pool,
  authority: SessionAuthority,
  input: { accountId: string; reason: SessionRevokeReason },
  log?: DrainLog,
): Promise<{ sids: string[] }> {
  const revoked = await revokeAccountSessions(pool, input);
  if (revoked.sids.length > 0) {
    await drainPendingDenies(pool, (sids) => authority.deny(sids), log);
  }
  return { sids: revoked.sids };
}
