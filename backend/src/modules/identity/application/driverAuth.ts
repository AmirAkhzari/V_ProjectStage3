import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { AppError } from '../../../platform/http/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../../platform/auth/jwt.js';
import type { AccessTokenSigner } from '../../../platform/auth/eddsa.js';
import { tokenTypeMismatch } from '../../../platform/auth/guards.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import {
  DUMMY_ARGON2ID_HASH,
  DRIVER_MAX_SESSIONS,
  hashUsernameForAudit,
  normalizeUsername,
  passwordOverLongBytes,
  usernameOverLong,
} from '../domain/loginPolicy.js';
import { needsPasswordRehash } from '../infra/crypto/argon2Hasher.js';
import type { PasswordHasher } from './ports.js';
import type { RefreshTokenStore } from './refreshStore.js';
import {
  clearLoginCounters,
  peekLoginBlock,
  recordLoginFailure,
  type LoginLimiterLimits,
} from './loginLimiter.js';
import { isRetryableLockError } from '../infra/session/lockOrder.js';
import {
  drainPendingDenies,
  revokeSessionsBySid,
  type DrainLog,
} from '../infra/session/pgSessionStore.js';
import { PgSessionStore } from '../infra/session/pgSessionStore.js';

export interface DriverAuthRuntime {
  identityPool: pg.Pool;
  redis: Redis;
  jwt: AccessTokenSigner;
  authority: SessionAuthority;
  store: RefreshTokenStore;
  hasher: PasswordHasher;
  log: DrainLog;
  maxSessions?: number;
  limiter?: LoginLimiterLimits;
}

export interface DriverUserView {
  id: string;
  username: string;
  distributorId: string;
}

export interface DriverSessionView {
  accessToken: string;
  accessTokenExpiresAt: string;
  absoluteExpiresAt: string;
  tokenType: 'Bearer';
  mustChangePassword: boolean;
  driver: DriverUserView;
  refreshToken?: string;
  refreshExpiresAt?: string;
}

interface DriverRow {
  account_id: string;
  distributor_id: string;
  password_hash: string;
  status: string;
}

export function invalidCredentials(): AppError {
  return new AppError('invalid_credentials', 401, 'Invalid credentials');
}

export function tooManyAttempts(retryAfter: number): AppError {
  return new AppError('too_many_attempts', 429, 'Too many attempts', { retryAfter });
}

function serviceUnavailable(retryAfter = 2): AppError {
  return new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
    retryAfter,
  });
}

function mapLockOr401(error: unknown): never {
  if (isRetryableLockError(error)) throw serviceUnavailable(2);
  if (error instanceof AppError) throw error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ISSUE_ABORTED'
  ) {
    throw invalidCredentials();
  }
  throw error;
}

export async function loginDriver(
  runtime: DriverAuthRuntime,
  input: { username: string; password: string; ip: string },
): Promise<DriverSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  const username = normalizeUsername(input.username);
  if (usernameOverLong(username) || passwordOverLongBytes(input.password)) {
    throw invalidCredentials();
  }
  const blocked = await peekLoginBlock(runtime.redis, username, input.ip, runtime.limiter);
  if (blocked) throw tooManyAttempts(blocked.retryAfter);

  let row: DriverRow | undefined;
  try {
    row = await lookupDriver(runtime.identityPool, username);
  } catch (error) {
    mapLockOr401(error);
  }
  const ok = await runtime.hasher.verify(row?.password_hash ?? DUMMY_ARGON2ID_HASH, input.password);
  if (!row || !ok || row.status !== 'active') {
    const outcome = await recordLoginFailure(runtime.redis, username, input.ip, runtime.limiter);
    try {
      await writeAudit(runtime.identityPool, {
        accountId: row?.account_id ?? 'unknown',
        distributorId: row?.distributor_id ?? null,
        action: 'login_failure',
        entityId: hashUsernameForAudit(username),
        ip: input.ip,
        data: { usernameHash: hashUsernameForAudit(username) },
      });
      if (outcome.locked) {
        await writeAudit(runtime.identityPool, {
          accountId: row?.account_id ?? 'unknown',
          distributorId: row?.distributor_id ?? null,
          action: 'login_lockout',
          entityId: hashUsernameForAudit(username),
          ip: input.ip,
          data: { usernameHash: hashUsernameForAudit(username) },
        });
      }
    } catch (error) {
      mapLockOr401(error);
    }
    if (outcome.limited) throw tooManyAttempts(outcome.retryAfter || 1);
    throw invalidCredentials();
  }
  await clearLoginCounters(runtime.redis, username, input.ip);
  return issueDriverSession(runtime, { ...row, username }, input.password, input.ip);
}

export async function refreshDriver(
  runtime: DriverAuthRuntime,
  refreshToken: string,
): Promise<DriverSessionView> {
  let result;
  try {
    result = await runtime.store.rotate(refreshToken, 'driver');
  } catch (error) {
    mapLockOr401(error);
  }
  if (result.status === 'rejected' && result.reason === 'lock_timeout') {
    throw serviceUnavailable(2);
  }
  if (result.status === 'rejected' && result.reason === 'typ_mismatch') {
    throw tokenTypeMismatch();
  }
  if (result.status === 'rejected') throw invalidCredentials();
  const snap = await new PgSessionStore(runtime.identityPool).lookup(result.sid);
  if (!snap || snap.revokedAt !== null || snap.accountStatus !== 'active' || !snap.distributorId) {
    throw invalidCredentials();
  }
  const accessToken = await runtime.jwt.sign({
    sub: snap.accountId,
    typ: 'driver',
    sid: snap.sid,
    sv: snap.sessionVersion,
    did: snap.distributorId,
  });
  const username = await requireUsername(runtime.identityPool, snap.accountId);
  const base = sessionBody({
    accessToken,
    mustChangePassword: snap.mustChangePassword,
    driver: { id: snap.accountId, username, distributorId: snap.distributorId },
    absolute: result.absoluteExpiresAt,
  });
  if (result.status === 'grace') return base;
  return {
    ...base,
    refreshToken: result.refreshToken,
    refreshExpiresAt: result.refreshExpiresAt.toISOString(),
  };
}

async function issueDriverSession(
  runtime: DriverAuthRuntime,
  row: DriverRow & { username: string },
  password: string,
  ip: string,
): Promise<DriverSessionView> {
  const now = new Date();
  let cas: { oldHash: string; nextHash: string } | undefined;
  if (needsPasswordRehash(row.password_hash)) {
    cas = { oldHash: row.password_hash, nextHash: await runtime.hasher.hash(password) };
  }
  const sid = randomUUID();
  let issued;
  try {
    issued = await runtime.store.issue({
      accountId: row.account_id,
      sid,
      familyId: randomUUID(),
      typ: 'driver',
      maxSessions: runtime.maxSessions ?? DRIVER_MAX_SESSIONS,
      distributorId: row.distributor_id,
      requireActive: true,
      ...(cas ? { casPasswordHash: cas } : {}),
    });
  } catch (error) {
    mapLockOr401(error);
  }
  const snap = await new PgSessionStore(runtime.identityPool).lookup(sid);
  if (!snap) throw serviceUnavailable(5);
  try {
    await runtime.authority.rememberLive(snap);
  } catch {
    await revokeSessionsBySid(runtime.identityPool, { sids: [sid], reason: 'logout_all' });
    await drainPendingDenies(
      runtime.identityPool,
      (sids) => runtime.authority.deny(sids),
      runtime.log,
    );
    throw serviceUnavailable(5);
  }
  await drainPendingDenies(
    runtime.identityPool,
    (sids) => runtime.authority.deny(sids),
    runtime.log,
  );
  await writeAudit(runtime.identityPool, {
    accountId: row.account_id,
    distributorId: row.distributor_id,
    action: 'login_success',
    entityId: sid,
    ip,
    data: { usernameHash: hashUsernameForAudit(row.username) },
    now,
  });
  const accessToken = await runtime.jwt.sign({
    sub: row.account_id,
    typ: 'driver',
    sid,
    sv: snap.sessionVersion,
    did: row.distributor_id,
  });
  return {
    ...sessionBody({
      accessToken,
      absolute: issued.absoluteExpiresAt,
      mustChangePassword: snap.mustChangePassword,
      driver: { id: row.account_id, username: row.username, distributorId: row.distributor_id },
    }),
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
  };
}

async function lookupDriver(pool: pg.Pool, username: string): Promise<DriverRow | undefined> {
  if (username.length === 0) return undefined;
  const found = await pool.query<DriverRow>(
    `SELECT account_id, distributor_id, password_hash, status FROM identity.lookup_driver_login($1)`,
    [username],
  );
  return found.rows[0];
}

async function requireUsername(pool: pg.Pool, accountId: string): Promise<string> {
  const found = await pool.query<{ username_norm: string }>(
    `SELECT username_norm FROM identity.accounts WHERE id = $1 AND username_norm IS NOT NULL`,
    [accountId],
  );
  const username = found.rows[0]?.username_norm;
  if (!username) throw invalidCredentials();
  return username;
}

function sessionBody(input: {
  accessToken: string;
  absolute: Date;
  mustChangePassword: boolean;
  driver: DriverUserView;
}): DriverSessionView {
  return {
    accessToken: input.accessToken,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    absoluteExpiresAt: input.absolute.toISOString(),
    tokenType: 'Bearer',
    mustChangePassword: input.mustChangePassword,
    driver: input.driver,
  };
}

async function writeAudit(
  pool: pg.Pool,
  input: {
    accountId: string;
    distributorId: string | null;
    action: string;
    entityId: string;
    ip: string;
    data: Record<string, unknown>;
    now?: Date;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO platform.audit_log (
       id, at, actor_type, actor_id, actor_name, distributor_id,
       action, entity, entity_id, data, ip
     ) VALUES ($1, $2, 'driver', $3, 'driver', $4, $5, 'account', $6, $7, $8)`,
    [
      randomUUID(),
      input.now ?? new Date(),
      input.accountId,
      input.distributorId,
      input.action,
      input.entityId,
      JSON.stringify(input.data),
      input.ip,
    ],
  );
}
