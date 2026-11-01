import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { AppError } from '../../../platform/http/errors.js';
import { withTenant } from '../../../platform/db/tenant.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../../platform/auth/jwt.js';
import type { AccessTokenSigner } from '../../../platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import {
  capPasswordBytes,
  DUMMY_ARGON2ID_HASH,
  DRIVER_MAX_SESSIONS,
  LOGIN_FAILURES_TO_LOCK,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_RATE_IP,
  LOGIN_RATE_USER,
  LOGIN_RATE_WINDOW_SECONDS,
  normalizeUsername,
} from '../domain/loginPolicy.js';
import { needsPasswordRehash } from '../infra/crypto/argon2Hasher.js';
import type { PasswordHasher } from './ports.js';
import type { RefreshTokenStore } from './refreshStore.js';
import {
  applyLockTimeout,
  lockSessionsThenTokensThenAccount,
  withRetryableTx,
} from '../infra/session/lockOrder.js';
import {
  drainPendingDenies,
  enqueuePendingDenies,
  PgSessionStore,
  revokeAccountSessions,
  type DrainLog,
} from '../infra/session/pgSessionStore.js';
import { SESSIONS_REVOKED_EVENT, SESSIONS_REVOKED_EVENT_VERSION } from '../events.js';

export interface DriverAuthRuntime {
  identityPool: pg.Pool;
  appPool: pg.Pool;
  redis: Redis;
  jwt: AccessTokenSigner;
  authority: SessionAuthority;
  store: RefreshTokenStore;
  hasher: PasswordHasher;
  log?: DrainLog;
  maxSessions?: number;
  rateUser?: number;
  rateIp?: number;
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

export async function loginDriver(
  runtime: DriverAuthRuntime,
  input: { username: string; password: string; ip: string },
): Promise<DriverSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  const username = normalizeUsername(input.username);
  const password = capPasswordBytes(input.password);
  await takeRate(runtime, `login:rl:user:${username}`, runtime.rateUser ?? LOGIN_RATE_USER);
  await takeRate(runtime, `login:rl:ip:${input.ip}`, runtime.rateIp ?? LOGIN_RATE_IP);
  const nameTaken = await distributorNameTaken(runtime.appPool, username);
  const row = nameTaken ? undefined : await lookupDriver(runtime.identityPool, username);
  const locked =
    username.length > 0 && (await runtime.redis.exists(`login:lock:${username}`)) === 1;
  const ok = await runtime.hasher.verify(row?.password_hash ?? DUMMY_ARGON2ID_HASH, password);
  if (!row || !ok || row.status !== 'active' || locked) {
    await recordFailure(runtime, username, row, input.ip);
    throw invalidCredentials();
  }
  return issueDriverSession(runtime, { ...row, username }, password, input.ip);
}

export async function refreshDriver(
  runtime: DriverAuthRuntime,
  refreshToken: string,
): Promise<DriverSessionView> {
  const result = await runtime.store.rotate(refreshToken, 'driver');
  if (result.status === 'rejected' && result.reason === 'lock_timeout') {
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
      retryAfter: 2,
    });
  }
  if (result.status === 'rejected' && result.reason === 'typ_mismatch') {
    throw new AppError('TOKEN_TYPE_MISMATCH', 401, 'Token type mismatch');
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
  const username = await usernameOf(runtime.identityPool, snap.accountId);
  const base = sessionBody({
    accessToken,
    mustChangePassword: snap.mustChangePassword,
    driver: { id: snap.accountId, username, distributorId: snap.distributorId },
    absolute: await absoluteOf(runtime.identityPool, snap.sid),
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
  await withRetryableTx(runtime.identityPool, async (client) => {
    await applyLockTimeout(client);
    await lockSessionsThenTokensThenAccount(client, {
      kind: 'account',
      accountId: row.account_id,
      lockAccount: true,
    });
    await client.query('SELECT set_config($1, $2, true)', [
      'app.distributor_id',
      row.distributor_id,
    ]);
    await client.query('SELECT set_config($1, $2, true)', ['app.subject_type', 'driver']);
    if (needsPasswordRehash(row.password_hash)) {
      const next = await runtime.hasher.hash(password);
      await client.query(
        `UPDATE identity.driver_credentials SET password_hash = $2 WHERE account_id = $1`,
        [row.account_id, next],
      );
    }
  });
  const sid = randomUUID();
  const issued = await runtime.store.issue({
    accountId: row.account_id,
    sid,
    familyId: randomUUID(),
    typ: 'driver',
  });
  const snap = await new PgSessionStore(runtime.identityPool).lookup(sid);
  if (!snap) throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable');
  try {
    await runtime.authority.rememberLive(snap);
  } catch {
    await revokeAccountSessions(runtime.identityPool, {
      accountId: row.account_id,
      reason: 'logout_all',
    });
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
      retryAfter: 5,
    });
  }
  await enforceSessionCap(runtime, row.account_id, sid, row.distributor_id);
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
    data: { username: row.username },
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

async function recordFailure(
  runtime: DriverAuthRuntime,
  username: string,
  row: DriverRow | undefined,
  ip: string,
): Promise<void> {
  const now = new Date();
  if (username.length > 0) {
    const fails = await runtime.redis.incr(`login:fail:${username}`);
    if (fails === 1) await runtime.redis.expire(`login:fail:${username}`, LOGIN_LOCKOUT_SECONDS);
    if (fails >= LOGIN_FAILURES_TO_LOCK) {
      await runtime.redis.set(`login:lock:${username}`, '1', 'EX', LOGIN_LOCKOUT_SECONDS);
      if (row) {
        await revokeAccountSessions(runtime.identityPool, {
          accountId: row.account_id,
          reason: 'lockout',
        });
        await drainPendingDenies(
          runtime.identityPool,
          (sids) => runtime.authority.deny(sids),
          runtime.log,
        );
      }
      await writeAudit(runtime.identityPool, {
        accountId: row?.account_id ?? 'unknown',
        distributorId: row?.distributor_id ?? null,
        action: 'login_lockout',
        entityId: username,
        ip,
        data: { username },
        now,
      });
    }
  }
  await writeAudit(runtime.identityPool, {
    accountId: row?.account_id ?? 'unknown',
    distributorId: row?.distributor_id ?? null,
    action: 'login_failure',
    entityId: username,
    ip,
    data: { username },
    now,
  });
}

async function enforceSessionCap(
  runtime: DriverAuthRuntime,
  accountId: string,
  keepSid: string,
  distributorId: string,
): Promise<void> {
  const cap = runtime.maxSessions ?? DRIVER_MAX_SESSIONS;
  const now = new Date();
  const { value: extras } = await withRetryableTx(runtime.identityPool, async (client) => {
    await applyLockTimeout(client);
    await lockSessionsThenTokensThenAccount(client, {
      kind: 'account',
      accountId,
      lockAccount: true,
    });
    const open = await client.query<{ sid: string; family_id: string }>(
      `SELECT sid, family_id FROM identity.sessions
        WHERE account_id = $1 AND revoked_at IS NULL
        ORDER BY created_at, sid`,
      [accountId],
    );
    const overflow = Math.max(0, open.rows.length - cap);
    const victims = open.rows.filter((row) => row.sid !== keepSid).slice(0, overflow);
    if (victims.length === 0) return [] as string[];
    const sids = victims.map((row) => row.sid);
    await enqueuePendingDenies(client, sids, now);
    await client.query(
      `UPDATE identity.sessions SET revoked_at = $2, revoke_reason = 'session_limit'
        WHERE sid = ANY($1::uuid[])`,
      [sids, now],
    );
    await client.query(
      `UPDATE identity.refresh_tokens SET rotated_at = COALESCE(rotated_at, $2), used_at = COALESCE(used_at, $2)
        WHERE sid = ANY($1::uuid[])`,
      [sids, now],
    );
    for (const victim of victims) {
      await client.query(
        `INSERT INTO platform.audit_log (
           id, at, actor_type, actor_id, actor_name, distributor_id,
           action, entity, entity_id, data, ip
         ) VALUES ($1, $2, 'system', $3, 'identity', $4, 'session_limit', 'session', $5, $6, NULL)`,
        [
          randomUUID(),
          now,
          accountId,
          distributorId,
          victim.family_id,
          JSON.stringify({ sid: victim.sid, familyId: victim.family_id, reason: 'session_limit' }),
        ],
      );
      await client.query(
        `INSERT INTO platform.outbox_events (
           id, event_type, event_version, aggregate_type, aggregate_id, distributor_id,
           payload, occurred_at, attempts
         ) VALUES ($1, $2, $3, 'session', $4, $5, $6, $7, 0)`,
        [
          randomUUID(),
          SESSIONS_REVOKED_EVENT,
          SESSIONS_REVOKED_EVENT_VERSION,
          victim.family_id,
          distributorId,
          JSON.stringify({
            familyId: victim.family_id,
            sid: victim.sid,
            accountId,
            reason: 'session_limit',
          }),
          now,
        ],
      );
    }
    return sids;
  });
  if (extras.length > 0) {
    await drainPendingDenies(
      runtime.identityPool,
      (sids) => runtime.authority.deny(sids),
      runtime.log,
    );
  }
}

async function takeRate(runtime: DriverAuthRuntime, key: string, limit: number): Promise<void> {
  const n = await runtime.redis.incr(key);
  if (n === 1) await runtime.redis.expire(key, LOGIN_RATE_WINDOW_SECONDS);
  if (n <= limit) return;
  const ttl = await runtime.redis.ttl(key);
  throw new AppError('RATE_LIMITED', 429, 'Too many attempts', {
    retryAfter: ttl > 0 ? ttl : LOGIN_RATE_WINDOW_SECONDS,
  });
}

export async function distributorNameTaken(appPool: pg.Pool, username: string): Promise<boolean> {
  if (username.length === 0) return false;
  return withTenant(appPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
    const found = await tx.client.query(
      `SELECT 1 FROM tenancy.distributors WHERE lower(name) = $1 LIMIT 1`,
      [username],
    );
    return (found.rowCount ?? 0) > 0;
  });
}

async function lookupDriver(pool: pg.Pool, username: string): Promise<DriverRow | undefined> {
  if (username.length === 0) return undefined;
  const found = await pool.query<DriverRow>(
    `SELECT account_id, distributor_id, password_hash, status FROM identity.lookup_driver_login($1)`,
    [username],
  );
  return found.rows[0];
}

async function usernameOf(pool: pg.Pool, accountId: string): Promise<string> {
  const found = await pool.query<{ username_norm: string | null }>(
    `SELECT username_norm FROM identity.accounts WHERE id = $1`,
    [accountId],
  );
  return found.rows[0]?.username_norm ?? '';
}

async function absoluteOf(pool: pg.Pool, sid: string): Promise<Date> {
  const found = await pool.query<{ absolute_expires_at: Date }>(
    `SELECT absolute_expires_at FROM identity.sessions WHERE sid = $1`,
    [sid],
  );
  return found.rows[0]?.absolute_expires_at ?? new Date();
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
    now: Date;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO platform.audit_log (
       id, at, actor_type, actor_id, actor_name, distributor_id,
       action, entity, entity_id, data, ip
     ) VALUES ($1, $2, 'driver', $3, 'driver', $4, $5, 'account', $6, $7, $8)`,
    [
      randomUUID(),
      input.now,
      input.accountId,
      input.distributorId,
      input.action,
      input.entityId,
      JSON.stringify(input.data),
      input.ip,
    ],
  );
}
