import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { AppError } from '../../../platform/http/errors.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../../platform/auth/jwt.js';
import type { AccessTokenSigner } from '../../../platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import type { SessionAuthority } from '../../../platform/auth/sessionAuthority.js';
import type { OtpPurpose, SmsProvider } from '../../notification/api.js';
import { smsRefundable } from '../../notification/api.js';
import { permissionsForRole, type StaffRole } from '../domain/permissions.js';
import {
  maskIranMobile,
  OTP_RESEND_SECONDS,
  OTP_TTL_SECONDS,
  smsHourSpike,
} from '../domain/otpPolicy.js';
import { generateRefreshToken, hashRefreshToken } from '../infra/crypto/refreshHash.js';
import type { RefreshTokenStore } from './refreshStore.js';
import {
  applyLockTimeout,
  isRetryableLockError,
  lockSessionsThenTokensThenAccount,
} from '../infra/session/lockOrder.js';
import {
  drainPendingDenies,
  PgSessionStore,
  revokeSessionsBySid,
  type DrainLog,
} from '../infra/session/pgSessionStore.js';
import { sessionWindows } from '../domain/sessionTtl.js';
import { refundOtpSend, reserveOtpSend, type OtpBudgetLimits } from './otpLimiter.js';
import {
  consumeOtpChallenge,
  deleteOtpChallengeIfIssuance,
  generateOtpCode,
  newOtpIssuanceId,
  otpPhoneHash,
  putOtpChallenge,
} from '../infra/otp/redisOtpStore.js';

export interface OtpAuthRuntime {
  identityPool: pg.Pool;
  redis: Redis;
  jwt: AccessTokenSigner;
  authority: SessionAuthority;
  store: RefreshTokenStore;
  sms: SmsProvider;
  log: DrainLog;
  pepper: string;
  budget: OtpBudgetLimits;
  spikeBaselineHour?: number;
  runAfterRespond?: (fn: () => void | Promise<void>) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface ShopkeeperSessionView {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  absoluteExpiresAt: string;
  tokenType: 'Bearer';
  user: { id: string; phone: string; isNewAccount: boolean };
}

export interface StaffSessionView {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  absoluteExpiresAt: string;
  tokenType: 'Bearer';
  staff: {
    id: string;
    phone: string;
    role: StaffRole;
    distributorId: string | null;
    permissions: string[];
  };
}

export interface OtpSendView {
  status: 'sent';
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface StaffOtpRow {
  account_id: string;
  role: string;
  distributor_id: string | null;
  status: string;
  permissions: string[];
}

const SEND_BODY: OtpSendView = {
  status: 'sent',
  expiresInSeconds: OTP_TTL_SECONDS,
  resendAfterSeconds: OTP_RESEND_SECONDS,
};

const una = (retry = 5) =>
  new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
    retryAfter: retry,
  });
const tooMany = (retryAfter: number) =>
  new AppError('too_many_attempts', 429, 'Too many attempts', { retryAfter });
const otpInvalid = () => new AppError('OTP_INVALID', 401, 'Invalid or expired code');
const otpLocked = () => new AppError('OTP_LOCKED', 401, 'Code locked');

function isIssueAborted(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'ISSUE_ABORTED',
  );
}

function mapIssueError(error: unknown): never {
  if (isRetryableLockError(error) || (error instanceof AppError && error.statusCode === 503)) {
    throw una(2);
  }
  if (isIssueAborted(error)) throw otpInvalid();
  throw una();
}

function mapRedis(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw una();
}

function runAfter(runtime: OtpAuthRuntime, fn: () => void | Promise<void>): void {
  (runtime.runAfterRespond ?? ((cb) => setImmediate(() => void cb())))(fn);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function applyDelay(runtime: OtpAuthRuntime, delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await (runtime.sleep ?? defaultSleep)(delayMs);
}

function logOtpSendOutcome(
  runtime: OtpAuthRuntime,
  outcome: 'sent' | 'suppressed' | 'refunded' | 'ops' | 'error',
  bindings: Record<string, unknown>,
): void {
  const payload = { otpSendOutcome: outcome, ...bindings };
  try {
    if (outcome === 'ops' || outcome === 'error') {
      runtime.log.error(payload, 'otp send outcome');
      return;
    }
    if (runtime.log.warn) {
      runtime.log.warn(payload, 'otp send outcome');
      return;
    }
    runtime.log.error(payload, 'otp send outcome');
  } catch {
    // Logging must not drop a live issuance.
  }
}

/** N18-1 / N18-6: exactly one active super_admin or distributor_admin membership. */
export async function lookupActiveStaffOtp(
  pool: pg.Pool,
  phone: string,
): Promise<StaffOtpRow | undefined> {
  const found = await pool.query<StaffOtpRow>(
    `SELECT account_id, role, distributor_id, status, permissions FROM identity.lookup_staff_otp($1)`,
    [phone],
  );
  if (found.rows.length !== 1) return undefined;
  const row = found.rows[0];
  if (!row || row.status !== 'active') return undefined;
  if (row.role !== 'super_admin' && row.role !== 'distributor_admin') return undefined;
  return { ...row, permissions: row.permissions ?? [] };
}

export async function sendOtp(
  runtime: OtpAuthRuntime,
  input: { purpose: OtpPurpose; phone: string; ip: string },
): Promise<OtpSendView> {
  await assertRedisForAuthIssuance(runtime.redis);
  let reservation;
  try {
    reservation = await reserveOtpSend(
      runtime.redis,
      input.phone,
      input.ip,
      runtime.pepper,
      runtime.budget,
    );
  } catch (error) {
    mapRedis(error);
  }
  if (reservation.status === 'blocked') throw tooMany(reservation.retryAfter);
  const reserved = reservation;
  const code = generateOtpCode();
  const issuanceId = newOtpIssuanceId();
  try {
    await putOtpChallenge(runtime.redis, {
      pepper: runtime.pepper,
      purpose: input.purpose,
      phone: input.phone,
      code,
      issuanceId,
    });
    await runtime.identityPool.query(
      `INSERT INTO identity.otp_challenges (id, purpose, phone_hmac, created_at)
       VALUES ($1, $2, $3, now())`,
      [randomUUID(), input.purpose, otpPhoneHash(input.phone, runtime.pepper)],
    );
  } catch (error) {
    await dropIssuance(runtime, {
      purpose: input.purpose,
      phone: input.phone,
      issuanceId,
    });
    await refundOtpSend(runtime.redis, input.phone, input.ip, runtime.pepper, reserved.token).catch(
      () => {},
    );
    mapRedis(error);
  }
  if (smsHourSpike(reserved.hourCount, runtime.spikeBaselineHour)) {
    runtime.log.error(
      {
        otpSendOutcome: 'spike',
        hourCount: reserved.hourCount,
        phoneMasked: maskIranMobile(input.phone),
      },
      'sms hour spike',
    );
  }
  await applyDelay(runtime, reserved.delayMs);
  runAfter(runtime, () =>
    dispatchSend(runtime, {
      purpose: input.purpose,
      phone: input.phone,
      ip: input.ip,
      code,
      issuanceId,
      token: reserved.token,
    }),
  );
  return SEND_BODY;
}

async function dropIssuance(
  runtime: OtpAuthRuntime,
  input: { purpose: OtpPurpose; phone: string; issuanceId: string },
): Promise<void> {
  await deleteOtpChallengeIfIssuance(runtime.redis, {
    pepper: runtime.pepper,
    purpose: input.purpose,
    phone: input.phone,
    issuanceId: input.issuanceId,
  }).catch(() => {});
}

async function dispatchSend(
  runtime: OtpAuthRuntime,
  input: {
    purpose: OtpPurpose;
    phone: string;
    ip: string;
    code: string;
    issuanceId: string;
    token: string;
  },
): Promise<void> {
  const phoneMasked = maskIranMobile(input.phone);
  try {
    if (input.purpose === 'staff') {
      const staff = await lookupActiveStaffOtp(runtime.identityPool, input.phone);
      if (!staff) {
        await dropIssuance(runtime, input);
        logOtpSendOutcome(runtime, 'suppressed', { purpose: input.purpose, phoneMasked });
        return;
      }
    }
    const result = await runtime.sms.sendOtp(input.phone, input.code, input.purpose);
    if (smsRefundable(result)) {
      await refundOtpSend(runtime.redis, input.phone, input.ip, runtime.pepper, input.token);
      await dropIssuance(runtime, input);
      logOtpSendOutcome(runtime, 'refunded', {
        purpose: input.purpose,
        phoneMasked,
        smsReason: result.reason ?? result.status,
      });
      return;
    }
    if (result.status === 'ops' || result.status === 'ambiguous') {
      logOtpSendOutcome(runtime, 'ops', {
        purpose: input.purpose,
        phoneMasked,
        smsReason: result.reason ?? result.status,
      });
      return;
    }
    logOtpSendOutcome(runtime, 'sent', { purpose: input.purpose, phoneMasked });
  } catch (error) {
    logOtpSendOutcome(runtime, 'error', { purpose: input.purpose, phoneMasked, err: error });
    if (input.purpose === 'staff') await dropIssuance(runtime, input);
  }
}

export async function verifyAppOtp(
  runtime: OtpAuthRuntime,
  input: { phone: string; code: string; ip: string },
): Promise<ShopkeeperSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  await consumeOrThrow(runtime, 'app', input);
  let issued;
  try {
    issued = await issueShopkeeper(runtime, input.phone, input.ip);
  } catch (error) {
    mapIssueError(error);
  }
  await rememberOrAbort(runtime, issued.sid);
  const snap = await new PgSessionStore(runtime.identityPool).lookup(issued.sid);
  if (!snap) throw una();
  const accessToken = await runtime.jwt.sign({
    sub: issued.accountId,
    typ: 'shopkeeper',
    sid: issued.sid,
    sv: snap.sessionVersion,
  });
  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: issued.absoluteExpiresAt.toISOString(),
    tokenType: 'Bearer',
    user: { id: issued.accountId, phone: input.phone, isNewAccount: issued.isNew },
  };
}

export async function verifyStaffOtp(
  runtime: OtpAuthRuntime,
  input: { phone: string; code: string; ip: string },
): Promise<StaffSessionView> {
  await assertRedisForAuthIssuance(runtime.redis);
  await consumeOrThrow(runtime, 'staff', input);
  const staff = await lookupActiveStaffOtp(runtime.identityPool, input.phone);
  if (!staff) throw otpInvalid();
  const role = staff.role as StaffRole;
  const sid = randomUUID();
  const now = new Date();
  let issued;
  try {
    issued = await runtime.store.issue({
      accountId: staff.account_id,
      sid,
      familyId: randomUUID(),
      typ: 'staff',
      requireActive: true,
      ...(staff.distributor_id ? { distributorId: staff.distributor_id } : {}),
      beforeCommit: async (client) => {
        await writeOtpAudit(client, {
          accountId: staff.account_id,
          actorType: 'staff',
          distributorId: staff.distributor_id,
          action: 'login_success',
          entityId: sid,
          ip: input.ip,
          phoneMasked: maskIranMobile(input.phone),
          now,
        });
      },
    });
  } catch (error) {
    mapIssueError(error);
  }
  await rememberOrAbort(runtime, sid);
  const snap = await new PgSessionStore(runtime.identityPool).lookup(sid);
  if (!snap) throw una();
  const accessToken = await runtime.jwt.sign({
    sub: staff.account_id,
    typ: 'staff',
    sid,
    sv: snap.sessionVersion,
    ...(staff.distributor_id ? { did: staff.distributor_id } : {}),
  });
  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: issued.absoluteExpiresAt.toISOString(),
    tokenType: 'Bearer',
    staff: {
      id: staff.account_id,
      phone: input.phone,
      role,
      distributorId: staff.distributor_id,
      permissions: [...permissionsForRole(role, staff.permissions)],
    },
  };
}

async function consumeOrThrow(
  runtime: OtpAuthRuntime,
  purpose: OtpPurpose,
  input: { phone: string; code: string },
): Promise<void> {
  let consumed;
  try {
    consumed = await consumeOtpChallenge(runtime.redis, {
      pepper: runtime.pepper,
      purpose,
      phone: input.phone,
      code: input.code,
    });
  } catch (error) {
    mapRedis(error);
  }
  if (consumed.status === 'limited') throw tooMany(consumed.retryAfter ?? 1);
  if (consumed.status === 'locked') throw otpLocked();
  if (consumed.status !== 'ok') throw otpInvalid();
}

async function issueShopkeeper(
  runtime: OtpAuthRuntime,
  phone: string,
  ip: string,
): Promise<{
  accountId: string;
  sid: string;
  isNew: boolean;
  refreshToken: string;
  refreshExpiresAt: Date;
  absoluteExpiresAt: Date;
}> {
  const sid = randomUUID();
  const familyId = randomUUID();
  const now = new Date();
  const windows = sessionWindows('shopkeeper', now, now);
  const refreshToken = generateRefreshToken();
  const hash = hashRefreshToken(refreshToken);
  const client = await runtime.identityPool.connect();
  try {
    await client.query('BEGIN');
    await applyLockTimeout(client);
    const ensured = await client.query<{ account_id: string; is_new: boolean; status: string }>(
      `SELECT account_id, is_new, status FROM identity.ensure_shopkeeper_account($1)`,
      [phone],
    );
    const row = ensured.rows[0];
    if (!row || row.status !== 'active') {
      throw Object.assign(new Error('inactive'), { code: 'ISSUE_ABORTED' });
    }
    await lockSessionsThenTokensThenAccount(client, {
      kind: 'account',
      accountId: row.account_id,
      lockAccount: true,
    });
    await client.query(
      `INSERT INTO identity.sessions
         (sid, account_id, typ, family_id, created_at, last_used_at, absolute_expires_at)
       VALUES ($1, $2, 'shopkeeper', $3, $4, $4, $5)`,
      [sid, row.account_id, familyId, now, windows.absoluteExpiresAt],
    );
    await client.query(
      `INSERT INTO identity.refresh_tokens
         (hash, family_id, sid, rotated_at, successor, used_at, grace_used_at)
       VALUES ($1, $2, $3, NULL, NULL, NULL, NULL)`,
      [hash, familyId, sid],
    );
    await writeOtpAudit(client, {
      accountId: row.account_id,
      actorType: 'shopkeeper',
      distributorId: null,
      action: 'login_success',
      entityId: sid,
      ip,
      phoneMasked: maskIranMobile(phone),
      now,
    });
    await client.query('COMMIT');
    return {
      accountId: row.account_id,
      sid,
      isNew: row.is_new,
      refreshToken,
      refreshExpiresAt: windows.refreshExpiresAt,
      absoluteExpiresAt: windows.absoluteExpiresAt,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function rememberOrAbort(runtime: OtpAuthRuntime, sid: string): Promise<void> {
  const snap = await new PgSessionStore(runtime.identityPool).lookup(sid);
  if (!snap) throw una();
  try {
    await runtime.authority.rememberLive(snap);
  } catch {
    await revokeSessionsBySid(runtime.identityPool, { sids: [sid], reason: 'logout_all' });
    await drainPendingDenies(
      runtime.identityPool,
      (sids) => runtime.authority.deny(sids),
      runtime.log,
    );
    throw una();
  }
  await drainPendingDenies(
    runtime.identityPool,
    (sids) => runtime.authority.deny(sids),
    runtime.log,
  );
}

async function writeOtpAudit(
  db: { query: (queryText: string, values?: unknown[]) => Promise<unknown> },
  input: {
    accountId: string;
    actorType: 'shopkeeper' | 'staff';
    distributorId: string | null;
    action: string;
    entityId: string;
    ip: string;
    phoneMasked: string;
    now?: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO platform.audit_log (
       id, at, actor_type, actor_id, actor_name, distributor_id,
       action, entity, entity_id, data, ip
     ) VALUES ($1, $2, $3, $4, $3, $5, $6, 'account', $7, $8, $9)`,
    [
      randomUUID(),
      input.now ?? new Date(),
      input.actorType,
      input.accountId,
      input.distributorId,
      input.action,
      input.entityId,
      JSON.stringify({ phoneMasked: input.phoneMasked }),
      input.ip,
    ],
  );
}
