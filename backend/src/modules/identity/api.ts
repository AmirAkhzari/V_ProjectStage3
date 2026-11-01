import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { SessionAuthority } from '../../platform/auth/sessionAuthority.js';
import { deactivateAccount } from './application/deactivateAccount.js';
import { assertIssuanceAllowed } from './application/loginGate.js';
import { revokeSubjectSessions } from './application/revokeSessions.js';
import type { SessionRevokeReason } from './events.js';
import { silentDrainLog } from './infra/session/pgSessionStore.js';

/**
 * Public synchronous API of the `identity` module (§9.3 rules 1 and 5).
 */
export interface IdentityApi {
  revokeSubjectSessions(input: {
    accountId: string;
    reason: SessionRevokeReason;
  }): Promise<{ sids: string[] }>;
  deactivateAccount(accountId: string): Promise<{ sids: string[] }>;
  assertIssuanceAllowed(
    accountId: string | null,
  ): Promise<{ status: 'ok' } | { status: 'rejected'; reason: 'invalid_credentials' }>;
}

export function createIdentityApi(
  pool: pg.Pool,
  authority: SessionAuthority,
  redis: Redis,
): IdentityApi {
  return {
    revokeSubjectSessions: (input) => revokeSubjectSessions(pool, authority, input, silentDrainLog),
    deactivateAccount: (accountId) => deactivateAccount(pool, authority, accountId, silentDrainLog),
    assertIssuanceAllowed: (accountId) => assertIssuanceAllowed(redis, pool, accountId),
  };
}
