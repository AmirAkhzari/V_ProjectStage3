import { createHash, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { assertRedisForAuthIssuance } from '../../../platform/auth/failClosed.js';
import { withTenant } from '../../../platform/db/tenant.js';
import { AppError, errorEnvelope, type PlatformErrorCode } from '../../../platform/http/errors.js';
import type { IdempotencyStore } from '../../../platform/http/idempotency.js';
import { PgIdempotencyStore } from '../../../platform/http/idempotencyPg.js';
import { systemClock, type Clock } from '../../../platform/lib/clock.js';
import type { DrainLog } from '../infra/session/pgSessionStore.js';
import {
  clearDriverLockout,
  driverLockedUntil,
  refundDriverUnlock,
  reserveDriverUnlock,
  UNLOCK_DRIVER_MAX_PER_HOUR,
} from './loginLimiter.js';

/**
 * B83 order: authz → RLS 404 → idempotency replay (no second limit hit) → LIM-B83-01 (429)
 * → effect + audit + completed idempotency in one PG tx → Redis DEL. A cross-tenant 404
 * therefore happens before any 429 can distinguish it.
 */

export interface DriverUnlockRuntime {
  identityPool: pg.Pool;
  redis: Redis;
  log: DrainLog;
  idempotency?: IdempotencyStore;
}

export interface DriverUnlockInput {
  driverId: string;
  staffId: string;
  staffRole: string;
  distributorId: string;
  body: unknown;
  idempotencyKeyHeader: string | string[] | undefined;
  ip: string;
  userAgent?: string | string[] | undefined;
}

export interface DriverUnlockView {
  driverId: string;
  wasLocked: boolean;
  lockedUntilBefore: string | null;
  active: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;

const fail = (code: PlatformErrorCode, statusCode: number, message: string, details?: unknown) =>
  new AppError(code, statusCode, message, details);
export const unavailable = (retryAfter = 5) =>
  fail('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', { retryAfter });
const notFound = () => fail('NOT_FOUND', 404, 'Resource not found');
const validationFailed = () => fail('VALIDATION_FAILED', 400, 'Request could not be processed');
const reasonRequired = () => fail('REASON_REQUIRED', 422, 'Reason is required');
const reasonTooLong = () => fail('REASON_TOO_LONG', 422, 'Reason is too long', { max: REASON_MAX });
const reuse = () =>
  fail('IDEMPOTENCY_KEY_REUSE', 422, 'Idempotency key was reused with a different body');
const inProgress = (retryAfter: number) =>
  fail('IDEMPOTENCY_IN_PROGRESS', 409, 'Request with this key is in progress', { retryAfter });
const rateLimited = (retryAfter: number) =>
  fail('RATE_LIMITED', 429, 'Too many requests', { retryAfter });
const SERVICE_UNAVAILABLE_ENVELOPE = errorEnvelope(
  'SERVICE_UNAVAILABLE',
  'Service temporarily unavailable',
  { retryAfter: 5 },
);

/** P7-5: audit-only. Strips C0/C1 controls (incl. CR/LF/TAB), trims, caps at 256 code points. */
export function normalizeUserAgent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\p{Cc}/gu, '').trim();
  const points = Array.from(clean);
  return points.length === 0 ? null : points.slice(0, 256).join('');
}

/**
 * `ReasonRequest.strict()` parsed by hand: Zod's min/max would surface as generic
 * VALIDATION_FAILED. Trim first; empty/short → REASON_REQUIRED, long → REASON_TOO_LONG.
 */
export function parseUnlockReason(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw reasonRequired();
  if (Object.keys(body).some((key) => key !== 'reason')) throw validationFailed();
  const raw = (body as { reason?: unknown }).reason;
  if (typeof raw !== 'string') throw reasonRequired();
  const reason = raw.trim();
  if (reason.length < 3) throw reasonRequired();
  // Never truncate (B83-06).
  if (reason.length > REASON_MAX) throw reasonTooLong();
  return reason;
}

export function readIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 128) {
    throw fail('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key header is required');
  }
  return value;
}

function bodyHash(reason: string): string {
  return createHash('sha256').update(JSON.stringify({ reason })).digest('hex');
}

/** Staff tenant context; never isPlatform: the credentials join is the RLS gate. */
const staffTenant = (distributorId: string) =>
  ({ subjectType: 'staff', distributorId, isPlatform: false }) as const;

async function lookupDriver(
  pool: pg.Pool,
  distributorId: string,
  driverId: string,
): Promise<{ username: string; status: string } | undefined> {
  // Unknown UUID must be the same 404, not a Postgres cast error.
  if (!UUID.test(driverId)) return undefined;
  return withTenant(pool, staffTenant(distributorId), async (tx) => {
    const { rows } = await tx.client.query<{ username_norm: string; status: string }>(
      `SELECT a.username_norm, a.status
         FROM identity.accounts a
         JOIN identity.driver_credentials c ON c.account_id = a.id
        WHERE a.id = $1 AND a.typ = 'driver'`,
      [driverId],
    );
    const row = rows[0];
    return row ? { username: row.username_norm, status: row.status } : undefined;
  });
}

const redisOr503 = <T>(fn: () => Promise<T>): Promise<T> =>
  fn().catch((error: unknown) => {
    throw error instanceof AppError ? error : unavailable();
  });

export async function unlockDriver(
  runtime: DriverUnlockRuntime,
  input: DriverUnlockInput,
  clock: Clock = systemClock,
): Promise<DriverUnlockView> {
  const reason = parseUnlockReason(input.body);
  const key = readIdempotencyKey(input.idempotencyKeyHeader);
  const requestHash = bodyHash(reason);
  const driver = await lookupDriver(runtime.identityPool, input.distributorId, input.driverId);
  if (!driver) throw notFound();
  const store = runtime.idempotency ?? new PgIdempotencyStore(runtime.identityPool);
  const scope = `B83:${input.driverId}`;
  const claim = await store.claim(scope, input.staffId, key, requestHash);
  if (claim.status === 'completed') {
    if (claim.record.requestHash !== requestHash) throw reuse();
    // P7-1/P7-9: pure replay, no Redis, limit or audit. A stored 503 stays a 503.
    if (claim.record.statusCode === 503) {
      const stored = claim.record.response as { error: { message: string; details?: unknown } };
      throw new AppError('SERVICE_UNAVAILABLE', 503, stored.error.message, stored.error.details);
    }
    return claim.record.response as DriverUnlockView;
  }
  if (claim.status === 'in_progress') throw inProgress(claim.retryAfter);
  let committed = false;
  let reserved = false;
  try {
    await assertRedisForAuthIssuance(runtime.redis);
    const limit = await redisOr503(() =>
      reserveDriverUnlock(runtime.redis, input.staffId, input.driverId),
    );
    if (!limit.allowed) throw rateLimited(limit.retryAfter);
    reserved = true;
    // Stable alert message; no username or IP in clear.
    if (limit.driverCount === UNLOCK_DRIVER_MAX_PER_HOUR) {
      runtime.log.info?.(
        { driverId: input.driverId, staffId: input.staffId },
        'driver_unlock_repeat_alert',
      );
    }
    const lockedUntil = await redisOr503(() => driverLockedUntil(runtime.redis, driver.username));
    const now = clock();
    const view: DriverUnlockView = {
      driverId: input.driverId,
      wasLocked: lockedUntil !== null,
      lockedUntilBefore: lockedUntil?.toISOString() ?? null,
      active: driver.status === 'active',
    };
    await withTenant(runtime.identityPool, staffTenant(input.distributorId), async (tx) => {
      await tx.client.query(
        `INSERT INTO platform.audit_log (id, at, actor_type, actor_id, actor_name, distributor_id, action, entity, entity_id, data, ip)
         VALUES ($1, $2, 'staff', $3, $4, $5, 'driver_lockout_cleared', 'account', $6, $7, $8)`,
        [
          randomUUID(),
          now,
          input.staffId,
          input.staffRole,
          input.distributorId,
          input.driverId,
          JSON.stringify({
            driverId: input.driverId,
            role: input.staffRole,
            distributorId: input.distributorId,
            reason,
            wasLocked: view.wasLocked,
            lockedUntilBefore: view.lockedUntilBefore,
            userAgent: normalizeUserAgent(input.userAgent),
          }),
          input.ip,
        ],
      );
      // Completed idempotency in the same PG transaction as the audit.
      const record = { requestHash, statusCode: 200, response: view };
      await store.complete(scope, input.staffId, key, record, tx.client);
    });
    committed = true;
    try {
      await clearDriverLockout(runtime.redis, driver.username);
    } catch (error) {
      // L-7-2: the commit stands (the audit row exists); only the Redis DEL is lost.
      runtime.log.error(
        { driverId: input.driverId, staffId: input.staffId },
        'driver_unlock_redis_clear_failed',
      );
      // P7-9 (a): best-effort downgrade of the same committed row, no retry loop.
      await store
        .complete(scope, input.staffId, key, {
          requestHash,
          statusCode: 503,
          response: SERVICE_UNAVAILABLE_ENVELOPE,
        })
        .catch(() =>
          runtime.log.error(
            { driverId: input.driverId, staffId: input.staffId },
            'idempotency_downgrade_failed',
          ),
        );
      throw error instanceof AppError ? error : unavailable();
    }
    return view;
  } catch (error) {
    // L-7-1: refund only a slot this attempt reserved; a 429 past the cap stays counted.
    if (!committed && reserved) {
      await refundDriverUnlock(runtime.redis, input.staffId, input.driverId).catch(() => {});
    }
    if (!committed) await store.abandon(scope, input.staffId, key).catch(() => {});
    throw error;
  }
}
