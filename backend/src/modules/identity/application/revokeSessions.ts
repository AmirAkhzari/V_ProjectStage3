import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import type { SessionRevokeReason } from '../events.js';
import { revokeAccountSessions } from '../infra/session/pgSessionStore.js';
import type pg from 'pg';

export async function revokeSubjectSessions(
  pool: pg.Pool,
  authority: SessionAuthority,
  input: { accountId: string; reason: SessionRevokeReason },
): Promise<{ sids: string[] }> {
  const revoked = await revokeAccountSessions(pool, input);
  if (revoked.sids.length > 0) {
    try {
      await authority.deny(revoked.sids);
    } catch {
      queueMicrotask(() => {
        void authority.deny(revoked.sids);
      });
    }
  }
  return { sids: revoked.sids };
}
