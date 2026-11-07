import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { AppError } from '../../../platform/http/errors.js';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import type { OtpPurpose, SmsProvider } from '../../notification/api.js';
import { smsRefundable } from '../../notification/api.js';
import {
  maskIranMobile,
  OTP_RESEND_SECONDS,
  OTP_TTL_SECONDS,
  smsHourSpike,
} from '../domain/otpPolicy.js';
import { refundOtpSend, reserveOtpSend, type OtpBudgetLimits } from './otpLimiter.js';
import {
  deleteOtpChallengeIfIssuance,
  generateOtpCode,
  newOtpIssuanceId,
  otpPhoneHash,
  putOtpChallenge,
} from '../infra/otp/redisOtpStore.js';

export interface OtpAuthLog {
  error(bindings: Record<string, unknown>, message: string): void;
  warn?(bindings: Record<string, unknown>, message: string): void;
  info?(bindings: Record<string, unknown>, message: string): void;
}

export interface OtpAuthRuntime {
  identityPool: pg.Pool;
  redis: Redis;
  sms: SmsProvider;
  log: OtpAuthLog;
  pepper: string;
  budget: OtpBudgetLimits;
  spikeBaselineHour?: number;
  runAfterRespond?: (fn: () => void | Promise<void>) => void;
  sleep?: (ms: number) => Promise<void>;
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
  if (outcome === 'ops' || outcome === 'error') {
    runtime.log.error(payload, 'otp send outcome');
    return;
  }
  (runtime.log.info ?? runtime.log.warn ?? runtime.log.error)(payload, 'otp send outcome');
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
