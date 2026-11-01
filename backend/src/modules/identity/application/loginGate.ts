import type { Redis } from 'ioredis';
import { AppError } from '../../../platform/http/errors.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import { lookupAccountStatus } from '../infra/session/pgSessionStore.js';
import type pg from 'pg';

export type LoginGateResult =
  { status: 'ok' } | { status: 'rejected'; reason: 'invalid_credentials' };

/**
 * AUTH-AV-01 / AUTH-DI-01 (c): Redis down ⇒ 503. Inactive account ⇒ invalid_credentials,
 * never driver_inactive, from login/refresh issuance (C1/C2 HTTP is S11b-4).
 */
export async function assertIssuanceAllowed(
  redis: Redis,
  pool: pg.Pool,
  accountId: string | null,
): Promise<LoginGateResult> {
  await assertRedisForAuthIssuance(redis);
  if (accountId === null) return { status: 'rejected', reason: 'invalid_credentials' };
  const status = await lookupAccountStatus(pool, accountId);
  if (status !== 'active') return { status: 'rejected', reason: 'invalid_credentials' };
  return { status: 'ok' };
}

export function invalidCredentials(): AppError {
  return new AppError('invalid_credentials', 401, 'Invalid credentials');
}
