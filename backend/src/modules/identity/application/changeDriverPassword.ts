import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DRIVER_MAX_SESSIONS, hashUsernameForAudit } from '../domain/loginPolicy.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  evaluateNewPassword,
  normalizePassword,
} from '../domain/passwordPolicy.js';
import { absoluteExpiresAt } from '../domain/sessionTtl.js';
import {
  PgSessionStore,
  drainPendingDenies,
  revokeAccountSessionsInTx,
} from '../infra/session/pgSessionStore.js';
import {
  applyLoginTarpit,
  clearPasswordChangeAttempts,
  refundLoginAttempt,
  releaseLoginInflight,
  reserveLoginAttempt,
  reservePasswordChangeAttempt,
  settleLoginSuccess,
  type LoginReservation,
} from './loginLimiter.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import { withTenant } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { systemClock, type Clock } from '../../../platform/lib/clock.js';
import {
  sessionBody,
  tooManyAttempts,
  type DriverAuthRuntime,
  type DriverSessionView,
} from './driverAuth.js';

const unavailable = (retryAfter = 2): AppError =>
  new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', { retryAfter });

/** C11: a wrong *current* password is 422 CURRENT_PASSWORD_INVALID, never 401. */
const badCurrent = (): AppError =>
  new AppError('CURRENT_PASSWORD_INVALID', 422, 'Current password is invalid');

function policyError(code: string): AppError {
  if (code === 'PASSWORD_TOO_SHORT') {
    return new AppError('PASSWORD_TOO_SHORT', 422, 'Password is too short');
  }
  if (code === 'PASSWORD_REUSED') {
    return new AppError('PASSWORD_REUSED', 422, 'Password was used before');
  }
  // ERROR_CODES.md: PASSWORD_CONTAINS_IDENTITY is never an HTTP code; it maps here.
  if (code === 'PASSWORD_BREACHED' || code === 'PASSWORD_CONTAINS_IDENTITY') {
    return new AppError('PASSWORD_BREACHED', 422, 'Password is not acceptable');
  }
  return new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');
}

// `driver_credentials` is RLS-forced: `withTenant` sets the distributor GUC LOCALLY.
async function loadCurrentCredential(pool: pg.Pool, accountId: string, sid: string) {
  const scope = await pool.query<{ distributor_id: string | null }>(
    `SELECT distributor_id FROM identity.lookup_account_scope($1)`,
    [accountId],
  );
  const distributorId = scope.rows[0]?.distributor_id;
  if (!distributorId) throw badCurrent();
  return withTenant(pool, { subjectType: 'driver', distributorId }, async (tx) => {
    const found = await tx.client.query<{
      username_norm: string;
      password_hash: string;
      temp_expires_at: Date | null;
      created_at: Date;
    }>(
      `SELECT a.username_norm, c.password_hash, c.temp_expires_at, s.created_at
         FROM identity.accounts a
         JOIN identity.driver_credentials c ON c.account_id = a.id
         JOIN identity.sessions s ON s.account_id = a.id
        WHERE a.id = $1 AND s.sid = $2`,
      [accountId, sid],
    );
    const row = found.rows[0];
    if (!row) throw badCurrent();
    return {
      username: row.username_norm,
      passwordHash: row.password_hash,
      tempExpiresAt: row.temp_expires_at,
      distributorId,
      authTime: row.created_at,
    };
  });
}
// C11 (AUTH-PW-04): Redis gate → limiters → argon2 → policy → one transaction + NEW session
export async function changeDriverPassword(
  runtime: DriverAuthRuntime,
  input: {
    /** From the verified access token only; never from the body. */
    accountId: string;
    sid: string;
    currentPassword: string;
    newPassword: string;
    ip: string;
  },
  clock: Clock = systemClock,
): Promise<DriverSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  if (!runtime.breachedPassword) throw unavailable(5);
  const credential = await loadCurrentCredential(runtime.identityPool, input.accountId, input.sid);
  const now = clock();
  if (now.getTime() >= absoluteExpiresAt('driver', credential.authTime).getTime()) {
    throw new AppError('SESSION_REVOKED', 401, 'Session revoked');
  }
  let reservation: LoginReservation;
  try {
    reservation = await reserveLoginAttempt(
      runtime.redis,
      credential.username,
      input.ip,
      runtime.limiter,
    );
  } catch {
    throw unavailable();
  }
  if (reservation.status === 'blocked') throw tooManyAttempts(reservation.retryAfter);
  const reserved = reservation;
  let settled = false;
  let refunded = false;
  const refund = async () => {
    if (refunded || settled) return;
    refunded = true;
    try {
      await refundLoginAttempt(runtime.redis, reserved);
    } catch {
      /* counters expire */
    }
  };
  try {
    const c11 = await reservePasswordChangeAttempt(runtime.redis, input.accountId).catch(
      async () => {
        await refund();
        throw unavailable();
      },
    );
    if (!c11.allowed) {
      await refund();
      throw tooManyAttempts(c11.retryAfter);
    }
    const currentOk = await runtime.hasher.verify(credential.passwordHash, input.currentPassword);
    const tempExpired =
      credential.tempExpiresAt !== null && credential.tempExpiresAt.getTime() <= now.getTime();
    if (!currentOk || tempExpired) {
      // v1.2.0 contract carry (L-6-3): AUTH-PW-03 has no dedicated code, so an expired temp
      // returns the same 422 CURRENT_PASSWORD_INVALID body as a wrong current (next contract).
      await applyLoginTarpit(reserved, runtime.limiter);
      throw badCurrent();
    }
    let nextHash: string;
    try {
      // P6-2: current password verified, so a policy reject must not count toward C1.
      const normalizedNew = normalizePassword(input.newPassword);
      if (normalizedNew.length < PASSWORD_MIN_LENGTH) throw policyError('PASSWORD_TOO_SHORT');
      if (normalizedNew.length > PASSWORD_MAX_LENGTH) {
        throw new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');
      }
      if (normalizePassword(input.currentPassword) === normalizedNew) {
        throw policyError('PASSWORD_REUSED');
      }
      const policy = evaluateNewPassword(normalizedNew, runtime.breachedPassword, {
        username: credential.username,
      });
      if (!policy.ok) throw policyError(policy.code);
      nextHash = await runtime.hasher.hash(policy.normalized);
    } catch (error) {
      await refund();
      throw error;
    }
    const newSid = randomUUID();
    let issued;
    try {
      issued = await runtime.store.issue(
        {
          accountId: input.accountId,
          sid: newSid,
          familyId: randomUUID(),
          typ: 'driver',
          maxSessions: runtime.maxSessions ?? DRIVER_MAX_SESSIONS,
          distributorId: credential.distributorId,
          requireActive: true,
          // CAS: under the issue lock the hash must still be the one we verified.
          verifiedPasswordHash: credential.passwordHash,
          authTime: credential.authTime,
          // Prior families are revoked before the new row is inserted, so the new sid is not
          // a revoke victim; E3/audit cover prior families only.
          beforeInsert: async (rawClient) => {
            const client = rawClient as unknown as pg.PoolClient;
            await client.query(
              `UPDATE identity.driver_credentials SET password_hash = $2, temp_expires_at = NULL
                WHERE account_id = $1`,
              [input.accountId, nextHash],
            );
            await client.query(
              `UPDATE identity.accounts
                  SET must_change_password = false, session_version = session_version + 1
                WHERE id = $1`,
              [input.accountId],
            );
            await revokeAccountSessionsInTx(client, {
              accountId: input.accountId,
              reason: 'password_change',
              now,
              alreadyLocked: true,
              bumpSessionVersion: false,
            });
            await client.query(
              `INSERT INTO platform.audit_log (
                 id, at, actor_type, actor_id, actor_name, distributor_id,
                 action, entity, entity_id, data, ip
               ) VALUES ($1, $2, 'driver', $3, 'driver', $4,
                         'driver_password_changed', 'account', $3, $5, $6)`,
              [
                randomUUID(),
                now,
                input.accountId,
                credential.distributorId,
                JSON.stringify({
                  usernameHash: hashUsernameForAudit(credential.username, runtime.auditHashKey),
                }),
                input.ip,
              ],
            );
          },
        },
        () => now,
      );
    } catch (error) {
      await refund();
      if (error instanceof AppError) throw error;
      throw unavailable();
    }

    const snap = await new PgSessionStore(runtime.identityPool).lookup(newSid);
    if (!snap) throw unavailable(5);
    await runtime.authority.rememberLive(snap);
    await drainPendingDenies(
      runtime.identityPool,
      (sids) => runtime.authority.deny(sids),
      runtime.log,
    );
    const accessToken = await runtime.jwt.sign({
      sub: snap.accountId,
      typ: 'driver',
      sid: snap.sid,
      sv: snap.sessionVersion,
      did: credential.distributorId,
    });
    try {
      await settleLoginSuccess(runtime.redis, reserved);
      settled = true;
      await clearPasswordChangeAttempts(runtime.redis, input.accountId);
    } catch {
      /* session already issued */
    }
    return {
      ...sessionBody({
        accessToken,
        absolute: issued.absoluteExpiresAt,
        mustChangePassword: false,
        driver: {
          id: snap.accountId,
          username: credential.username,
          distributorId: credential.distributorId,
        },
      }),
      refreshToken: issued.refreshToken,
      refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    };
  } finally {
    if (!settled && !refunded) {
      await releaseLoginInflight(runtime.redis, reserved).catch(() => {});
    }
  }
}
