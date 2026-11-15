import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { pino } from 'pino';
import { buildApp, type App } from '../../src/app.js';
import type { DriverAuthRuntime } from '../../src/modules/identity/application/driverAuth.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import { refreshSchemaValidators } from '../helpers/frozenSessionSchemas.js';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import { hashRefreshToken } from '../../src/modules/identity/infra/crypto/refreshHash.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import {
  PgSessionStore,
  silentDrainLog,
} from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { FakeSmsProvider } from '../../src/modules/notification/infra/sms/fakeSmsProvider.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { TEST_AUDIT_HASH_KEY, TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';
import { pinoOptions } from '../../src/platform/logger.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST = '11111111-1111-4111-8111-111111111111';
const DIST2 = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'correct-horse-12';
const DAY = 24 * 60 * 60 * 1000;
let phoneSeq = 100000000;
let ipSeq = 1;
function nextPhone(): string {
  phoneSeq += 1;
  return `+989${String(phoneSeq).padStart(9, '0')}`;
}
function nextIp(): string {
  const n = ipSeq++;
  return `198.51.${(n >> 8) & 255}.${n & 255}`;
}
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0;
}

describe('S11b-5b A3/A4/B3/B4', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let jwt: EddsaAccessTokenService;
  let fake: FakeSmsProvider;
  let otp: OtpAuthRuntime;
  let driver: DriverAuthRuntime;
  let app: App;
  let afterRespond: Promise<void> = Promise.resolve();
  let clockAt: Date | undefined;
  const logs: string[] = [];
  const clock = () => clockAt ?? new Date();

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool({ connectionString: pgRoles.identityUrl });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    attachPgTeardownGuard(identityPool);
    attachPgTeardownGuard(ownerPool);
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
    const authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [await generateEd25519Key('k1')],
    });
    fake = new FakeSmsProvider({ capture: true });
    const log = pino(pinoOptions({ LOG_LEVEL: 'info' }), {
      write(chunk: string) {
        logs.push(chunk);
      },
    });
    const store = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: (sids) => authority.deny(sids),
      log,
    });
    const hasher = new Argon2idPasswordHasher();
    otp = {
      identityPool,
      redis,
      jwt,
      authority,
      store,
      sms: fake,
      log,
      pepper: TEST_OTP_HMAC_KEY,
      budget: { hour: 0, day: 0, skipBudget: true },
      clock,
      runAfterRespond: (fn) => {
        afterRespond = Promise.resolve(fn());
      },
    };
    driver = {
      identityPool,
      redis,
      jwt,
      authority,
      store,
      hasher,
      log,
      auditHashKey: TEST_AUDIT_HASH_KEY,
      clock,
      limiter: { tarpitAfter: 100 },
    };
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at) VALUES
         ($1, 'Dist A', 'active', now()), ($2, 'Dist B', 'active', now())`,
      [DIST, DIST2],
    );
    app = await buildApp({
      config: testConfig({ TRUST_PROXY_HOPS: '1', LOG_LEVEL: 'info' }),
      logDestination: {
        write(chunk: string) {
          logs.push(chunk);
        },
      },
      healthChecks: [],
      verifier: jwt,
      sessionAuthority: authority,
      assertIssuance: () => assertRedisForAuthIssuance(redis),
      otpAuth: otp,
      driverAuth: driver,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit().catch(() => redis?.disconnect());
    await identityPool?.end();
    await ownerPool?.end();
    await redisBox?.stop();
    await pgRoles?.postgres.stop();
  });

  beforeEach(async () => {
    clockAt = undefined;
    logs.length = 0;
    fake.outbox.length = 0;
    const keys = [...(await redis.keys('otp:*')), ...(await redis.keys('login:*'))];
    if (keys.length > 0) await redis.del(...keys);
  });

  const post = async (url: string, payload?: object, headers: Record<string, string> = {}) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: {
        'x-forwarded-for': nextIp(),
        'user-agent': 's11b5b-ua',
        'content-type': 'application/json',
        ...headers,
      },
      ...(payload === undefined ? {} : { payload }),
    });
    await afterRespond;
    return response;
  };

  async function clearOtpLimits(): Promise<void> {
    const keys = await redis.keys('otp:lim:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function loginShop(phone = nextPhone()) {
    await clearOtpLimits();
    expect((await post('/v1/app/auth/otp/send', { phone })).statusCode).toBe(200);
    const code = fake.outbox.at(-1)?.code;
    expect(code).toMatch(/^[0-9]{6}$/);
    const verified = await post('/v1/app/auth/otp/verify', { phone, code });
    expect(verified.statusCode).toBe(200);
    return {
      phone,
      ...(verified.json() as {
        accessToken: string;
        refreshToken: string;
        absoluteExpiresAt: string;
        user: { id: string };
      }),
    };
  }

  function claimsOf(token: string): { exp: number; iat: number; sid: string; did?: string } {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      exp: number;
      iat: number;
      sid: string;
      did?: string;
    };
  }

  async function actionCount(accountId: string, action: string): Promise<string> {
    const row = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.audit_log WHERE actor_id = $1 AND action = $2`,
      [accountId, action],
    );
    return row.rows[0]?.c ?? '0';
  }

  async function seedStaff(role: 'super_admin' | 'distributor_admin', dist: string | null) {
    const phone = nextPhone();
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, $2, $3, '{}')`,
      [accountId, role, dist],
    );
    return { phone, accountId };
  }

  async function verifyStaff(phone: string) {
    await clearOtpLimits();
    expect((await post('/v1/admin/auth/otp/send', { phone })).statusCode).toBe(200);
    const code = fake.outbox.at(-1)?.code;
    expect(code).toMatch(/^[0-9]{6}$/);
    const verified = await post('/v1/admin/auth/otp/verify', { phone, code });
    expect(verified.statusCode).toBe(200);
    return verified.json() as {
      accessToken: string;
      refreshToken: string;
      absoluteExpiresAt: string;
      staff: { distributorId: string | null; role: string };
    };
  }

  async function loginStaff(
    role: 'super_admin' | 'distributor_admin' = 'distributor_admin',
    dist: string | null = DIST,
  ) {
    const seeded = await seedStaff(role, dist);
    return { ...seeded, body: await verifyStaff(seeded.phone) };
  }

  async function loginDriverUser() {
    const accountId = randomUUID();
    const username = `u${accountId.slice(0, 8)}`;
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'driver', $2, $3, 'active', 0, false, now())`,
      [accountId, nextPhone(), username],
    );
    await ownerPool.query(
      `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash)
       VALUES ($1, $2, $3)`,
      [accountId, DIST, await new Argon2idPasswordHasher().hash(PASSWORD)],
    );
    const verified = await post('/v1/driver/auth/login', { username, password: PASSWORD });
    expect(verified.statusCode).toBe(200);
    return {
      accountId,
      body: verified.json() as { accessToken: string; refreshToken: string },
    };
  }

  async function familyOf(access: string, typ: 'shopkeeper' | 'staff' | 'driver') {
    const claims = await jwt.verify(access, typ);
    const row = await ownerPool.query<{ family_id: string; revoked_at: Date | null }>(
      `SELECT family_id, revoked_at FROM identity.sessions WHERE sid = $1`,
      [claims.sid],
    );
    return {
      sid: claims.sid,
      did: claims.did,
      familyId: row.rows[0]?.family_id ?? '',
      revoked: row.rows[0]?.revoked_at != null,
    };
  }

  async function tokenCount(accountId: string): Promise<number> {
    const row = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.refresh_tokens t
         JOIN identity.sessions s ON s.sid = t.sid WHERE s.account_id = $1`,
      [accountId],
    );
    return Number(row.rows[0]?.c ?? 0);
  }

  async function authed(url: string, access: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${access}` },
    });
  }

  it('A3/B3 G1-G7 U1 L1: rotate, grace, reuse, uniform 401, schema, redaction', async () => {
    const schemas = refreshSchemaValidators();
    const shop = await loginShop();
    const absolute = shop.absoluteExpiresAt;
    const rotated = await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken });
    expect(rotated.statusCode).toBe(200);
    const rotatedBody = rotated.json();
    expect(rotatedBody.refreshToken).toEqual(expect.any(String));
    expect(rotatedBody.refreshExpiresAt).toEqual(expect.any(String));
    expect(rotatedBody.absoluteExpiresAt).toBe(absolute);
    expect(rotatedBody.user.isNewAccount).toBe(false);
    expect(schemas.shopkeeper(rotatedBody)).toBe(true);
    expect(rotated.body).not.toContain(shop.refreshToken);
    const used = await ownerPool.query<{ last_used_at: Date }>(
      `SELECT last_used_at FROM identity.sessions WHERE sid = $1`,
      [(await familyOf(shop.accessToken, 'shopkeeper')).sid],
    );
    const tokensBeforeGrace = await tokenCount(shop.user.id);
    const grace = await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken });
    expect(grace.statusCode).toBe(200);
    expect(grace.json().refreshToken).toBeUndefined();
    expect(grace.json().refreshExpiresAt).toBeUndefined();
    expect(grace.json().absoluteExpiresAt).toBe(absolute);
    expect(schemas.shopkeeper(grace.json())).toBe(true);
    const graceClaims = claimsOf(grace.json().accessToken);
    expect(graceClaims.exp - graceClaims.iat).toBeLessThanOrEqual(15 * 60);
    expect(graceClaims.sid).toBe(claimsOf(shop.accessToken).sid);
    expect(await tokenCount(shop.user.id)).toBe(tokensBeforeGrace);
    const afterGrace = await ownerPool.query<{ last_used_at: Date }>(
      `SELECT last_used_at FROM identity.sessions WHERE sid = $1`,
      [(await familyOf(shop.accessToken, 'shopkeeper')).sid],
    );
    expect(afterGrace.rows[0]?.last_used_at.toISOString()).toBe(
      used.rows[0]?.last_used_at.toISOString(),
    );
    const graceAudit = await ownerPool.query<{ data: { ua?: string }; ip: string }>(
      `SELECT data, ip FROM platform.audit_log
        WHERE actor_id = $1 AND action = 'refresh_grace_replay'`,
      [shop.user.id],
    );
    expect(graceAudit.rows).toHaveLength(1);
    expect(graceAudit.rows[0]?.ip).toBeTruthy();
    expect(graceAudit.rows[0]?.data.ua).toBe('s11b5b-ua');
    expect(JSON.stringify(graceAudit.rows)).not.toContain(shop.refreshToken);
    const reuse = await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
    expect((await familyOf(shop.accessToken, 'shopkeeper')).revoked).toBe(true);
    const reuseRows = await ownerPool.query(
      `SELECT 1 FROM platform.audit_log WHERE actor_id = $1 AND action = 'refresh_reuse'`,
      [shop.user.id],
    );
    expect(reuseRows.rowCount).toBe(1);
    const e3 = await ownerPool.query(
      `SELECT 1 FROM platform.outbox_events
        WHERE payload->>'accountId' = $1 AND payload->>'reason' = 'refresh_reuse'`,
      [shop.user.id],
    );
    expect(e3.rowCount).toBe(1);
    expect((await authed('/v1/app/still-there', grace.json().accessToken)).statusCode).toBe(401);
    const shopReasons = await ownerPool.query<{ revoke_reason: string }>(
      `SELECT revoke_reason FROM identity.sessions WHERE family_id = $1`,
      [(await familyOf(shop.accessToken, 'shopkeeper')).familyId],
    );
    expect(shopReasons.rows.every((row) => row.revoke_reason === 'refresh_reuse')).toBe(true);

    const staff = await loginStaff();
    const staffAbs = staff.body.absoluteExpiresAt;
    const staffRot = await post('/v1/admin/auth/refresh', {
      refreshToken: staff.body.refreshToken,
    });
    expect(staffRot.statusCode).toBe(200);
    expect(staffRot.json().absoluteExpiresAt).toBe(staffAbs);
    expect(staffRot.json().staff.distributorId).toBe(DIST);
    expect(schemas.staff(staffRot.json())).toBe(true);
    const staffGrace = await post('/v1/admin/auth/refresh', {
      refreshToken: staff.body.refreshToken,
    });
    expect(staffGrace.statusCode).toBe(200);
    expect(staffGrace.json().refreshToken).toBeUndefined();
    expect(schemas.staff(staffGrace.json())).toBe(true);
    const staffReuse = await post('/v1/admin/auth/refresh', {
      refreshToken: staff.body.refreshToken,
    });
    expect(staffReuse.statusCode).toBe(401);
    expect(staffReuse.json()).toEqual(reuse.json());
    expect(await actionCount(staff.accountId, 'refresh_reuse')).toBe('1');
    const staffE3 = await ownerPool.query(
      `SELECT 1 FROM platform.outbox_events
        WHERE payload->>'accountId' = $1 AND payload->>'reason' = 'refresh_reuse'`,
      [staff.accountId],
    );
    expect(staffE3.rowCount).toBe(1);
    expect((await authed('/v1/admin/still-there', staffGrace.json().accessToken)).statusCode).toBe(
      401,
    );
    const staffParallel = await loginStaff();
    const staffParent = staffParallel.body.refreshToken;
    expect((await post('/v1/admin/auth/refresh', { refreshToken: staffParent })).statusCode).toBe(
      200,
    );
    const staffRaced = await Promise.all(
      Array.from({ length: 10 }, () =>
        post('/v1/admin/auth/refresh', { refreshToken: staffParent }),
      ),
    );
    expect(
      staffRaced.filter((row) => row.statusCode === 200 && !row.json().refreshToken),
    ).toHaveLength(1);
    expect((await familyOf(staffParallel.body.accessToken, 'staff')).revoked).toBe(true);
    expect(await actionCount(staffParallel.accountId, 'refresh_reuse')).toBe('1');
    const staffReasons = await ownerPool.query<{ revoke_reason: string }>(
      `SELECT revoke_reason FROM identity.sessions WHERE family_id = $1`,
      [(await familyOf(staffParallel.body.accessToken, 'staff')).familyId],
    );
    expect(staffReasons.rows.every((row) => row.revoke_reason === 'refresh_reuse')).toBe(true);
    const staffParallelE3 = await ownerPool.query(
      `SELECT 1 FROM platform.outbox_events
        WHERE payload->>'accountId' = $1 AND payload->>'reason' = 'refresh_reuse'`,
      [staffParallel.accountId],
    );
    expect(staffParallelE3.rowCount).toBe(1);

    const parallel = await loginShop();
    const parent = parallel.refreshToken;
    expect((await post('/v1/app/auth/refresh', { refreshToken: parent })).statusCode).toBe(200);
    const raced = await Promise.all(
      Array.from({ length: 10 }, () => post('/v1/app/auth/refresh', { refreshToken: parent })),
    );
    const graces = raced.filter((row) => row.statusCode === 200 && !row.json().refreshToken);
    expect(graces).toHaveLength(1);
    expect(raced.filter((row) => row.statusCode === 200 && row.json().refreshToken)).toHaveLength(
      0,
    );
    const shopParallelFamily = await familyOf(parallel.accessToken, 'shopkeeper');
    expect(shopParallelFamily.revoked).toBe(true);
    expect(await actionCount(parallel.user.id, 'refresh_reuse')).toBe('1');
    const shopParallelE3 = await ownerPool.query(
      `SELECT 1 FROM platform.outbox_events
        WHERE payload->>'accountId' = $1 AND payload->>'reason' = 'refresh_reuse'`,
      [parallel.user.id],
    );
    expect(shopParallelE3.rowCount).toBe(1);
    const shopParallelReasons = await ownerPool.query<{ revoke_reason: string }>(
      `SELECT revoke_reason FROM identity.sessions WHERE family_id = $1`,
      [shopParallelFamily.familyId],
    );
    expect(shopParallelReasons.rows.every((row) => row.revoke_reason === 'refresh_reuse')).toBe(
      true,
    );

    const lockedSession = await loginShop();
    const before = await tokenCount(lockedSession.user.id);
    const locker = await identityPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(`SELECT set_config('lock_timeout', '15s', true)`);
      await locker.query(`SELECT hash FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`, [
        hashRefreshToken(lockedSession.refreshToken),
      ]);
      const locked = await post('/v1/app/auth/refresh', {
        refreshToken: lockedSession.refreshToken,
      });
      expect(locked.statusCode).toBe(503);
      expect(locked.headers['retry-after']).toBeTruthy();
      expect(await tokenCount(lockedSession.user.id)).toBe(before);
      expect(await actionCount(lockedSession.user.id, 'refresh_reuse')).toBe('0');
      expect(await actionCount(lockedSession.user.id, 'refresh_grace_replay')).toBe('0');
      const marker = await ownerPool.query<{ grace_used_at: Date | null; revoked_at: Date | null }>(
        `SELECT t.grace_used_at, s.revoked_at
           FROM identity.refresh_tokens t
           JOIN identity.sessions s ON s.sid = t.sid
          WHERE t.hash = $1`,
        [hashRefreshToken(lockedSession.refreshToken)],
      );
      expect(marker.rows[0]?.grace_used_at).toBeNull();
      expect(marker.rows[0]?.revoked_at).toBeNull();
      await locker.query('ROLLBACK');
    } finally {
      locker.release();
    }
    expect(
      (await post('/v1/app/auth/refresh', { refreshToken: lockedSession.refreshToken })).statusCode,
    ).toBe(200);

    const lockedStaff = await loginStaff();
    const staffBefore = await tokenCount(lockedStaff.accountId);
    const staffLocker = await identityPool.connect();
    try {
      await staffLocker.query('BEGIN');
      await staffLocker.query(`SELECT set_config('lock_timeout', '15s', true)`);
      await staffLocker.query(
        `SELECT hash FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`,
        [hashRefreshToken(lockedStaff.body.refreshToken)],
      );
      const locked = await post('/v1/admin/auth/refresh', {
        refreshToken: lockedStaff.body.refreshToken,
      });
      expect(locked.statusCode).toBe(503);
      expect(locked.headers['retry-after']).toBeTruthy();
      expect(await tokenCount(lockedStaff.accountId)).toBe(staffBefore);
      expect(await actionCount(lockedStaff.accountId, 'refresh_reuse')).toBe('0');
      expect(await actionCount(lockedStaff.accountId, 'refresh_grace_replay')).toBe('0');
      const marker = await ownerPool.query<{ grace_used_at: Date | null; revoked_at: Date | null }>(
        `SELECT t.grace_used_at, s.revoked_at
           FROM identity.refresh_tokens t JOIN identity.sessions s ON s.sid = t.sid
          WHERE t.hash = $1`,
        [hashRefreshToken(lockedStaff.body.refreshToken)],
      );
      expect(marker.rows[0]?.grace_used_at).toBeNull();
      expect(marker.rows[0]?.revoked_at).toBeNull();
      await staffLocker.query('ROLLBACK');
    } finally {
      staffLocker.release();
    }

    clockAt = new Date('2026-04-01T00:00:00.000Z');
    const windowed = await loginShop();
    const spun = await post('/v1/app/auth/refresh', { refreshToken: windowed.refreshToken });
    expect(spun.statusCode).toBe(200);
    expect(
      (await post('/v1/app/auth/refresh', { refreshToken: spun.json().refreshToken })).statusCode,
    ).toBe(200);
    const usedParent = await post('/v1/app/auth/refresh', { refreshToken: windowed.refreshToken });
    expect(usedParent.statusCode).toBe(401);
    clockAt = new Date('2026-04-02T00:00:00.000Z');
    const late = await loginShop();
    expect(
      (await post('/v1/app/auth/refresh', { refreshToken: late.refreshToken })).statusCode,
    ).toBe(200);
    clockAt = new Date(clockAt.getTime() + 21_000);
    const outside = await post('/v1/app/auth/refresh', { refreshToken: late.refreshToken });
    expect(outside.statusCode).toBe(401);
    clockAt = undefined;

    const unknown = await post('/v1/app/auth/refresh', { refreshToken: 'b'.repeat(43) });
    const malformed = await post('/v1/app/auth/refresh', { refreshToken: 'short' });
    const extra = await post('/v1/app/auth/refresh', { refreshToken: 'c'.repeat(43), x: 1 });
    const c2short = await post('/v1/driver/auth/refresh', { refreshToken: 'short' });
    for (const row of [unknown, malformed, extra, c2short, reuse]) {
      expect(row.statusCode).toBe(401);
      expect(row.json()).toEqual(unknown.json());
      expect(JSON.stringify(row.json())).not.toContain('session_expired');
    }
    const idleStaff = await loginStaff();
    clockAt = new Date(Date.now() + 13 * 60 * 60 * 1000);
    const bIdle = await post('/v1/admin/auth/refresh', {
      refreshToken: idleStaff.body.refreshToken,
    });
    clockAt = undefined;
    const revokedStaff = await loginStaff();
    await ownerPool.query(
      `UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE account_id = $1`,
      [revokedStaff.accountId],
    );
    const bRevoked = await post('/v1/admin/auth/refresh', {
      refreshToken: revokedStaff.body.refreshToken,
    });
    const bUnknown = await post('/v1/admin/auth/refresh', { refreshToken: 'b'.repeat(43) });
    const bShort = await post('/v1/admin/auth/refresh', { refreshToken: 'short' });
    for (const row of [bUnknown, bShort, bIdle, bRevoked, staffReuse]) {
      expect(row.statusCode).toBe(401);
      expect(row.json()).toEqual(unknown.json());
    }
    expect(logs.join('')).not.toContain(shop.refreshToken);
    expect(logs.join('')).not.toContain(hashRefreshToken(shop.refreshToken));
  }, 90_000);

  it('AUTH-RT-04 / ruling 3: 3x3 refresh matrix is uniform 401 and does not revoke', async () => {
    const shop = await loginShop();
    const staff = await loginStaff();
    const drv = await loginDriverUser();
    const rows = [
      {
        url: '/v1/app/auth/refresh',
        group: 'shopkeeper' as const,
        token: shop.refreshToken,
        access: shop.accessToken,
      },
      {
        url: '/v1/admin/auth/refresh',
        group: 'staff' as const,
        token: staff.body.refreshToken,
        access: staff.body.accessToken,
      },
      {
        url: '/v1/driver/auth/refresh',
        group: 'driver' as const,
        token: drv.body.refreshToken,
        access: drv.body.accessToken,
      },
    ];
    const probe = rows[0];
    if (!probe) throw new Error('matrix');
    for (const route of rows) {
      for (const token of rows) {
        if (token.group === route.group) continue;
        const res = await post(route.url, { refreshToken: token.token });
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHENTICATED');
        expect(res.json()).toEqual(
          (await post('/v1/app/auth/refresh', { refreshToken: 'd'.repeat(43) })).json(),
        );
        expect((await familyOf(token.access, token.group)).revoked).toBe(false);
      }
    }
    const audits = await ownerPool.query(
      `SELECT count(*)::text AS c FROM platform.audit_log
        WHERE action = 'refresh_typ_mismatch' AND actor_id = $1`,
      [shop.user.id],
    );
    expect(Number(audits.rows[0]?.c)).toBeGreaterThan(0);
    expect(
      (await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken })).statusCode,
    ).toBe(200);
  });

  it('AUTH-RT-03: continuous use to the absolute cap; idle is not reset by grace', async () => {
    const shop = await loginShop();
    let token = shop.refreshToken;
    let cursor = Date.now();
    const absoluteAt = new Date(shop.absoluteExpiresAt).getTime();
    while (cursor + 29 * DAY < absoluteAt) {
      cursor += 29 * DAY;
      clockAt = new Date(cursor);
      const step = await post('/v1/app/auth/refresh', { refreshToken: token });
      expect(step.statusCode).toBe(200);
      expect(step.json().absoluteExpiresAt).toBe(shop.absoluteExpiresAt);
      token = step.json().refreshToken;
    }
    clockAt = new Date(absoluteAt - 1000);
    const day90 = await post('/v1/app/auth/refresh', { refreshToken: token });
    expect(day90.statusCode).toBe(200);
    expect(day90.json().absoluteExpiresAt).toBe(shop.absoluteExpiresAt);
    clockAt = new Date(absoluteAt + 1000);
    const day91 = await post('/v1/app/auth/refresh', { refreshToken: day90.json().refreshToken });
    expect(day91.statusCode).toBe(401);
    expect(day91.json().error.code).toBe('UNAUTHENTICATED');
    clockAt = undefined;
    const idleShop = await loginShop();
    clockAt = new Date(Date.now() + 30 * DAY + 60 * 1000);
    const idleOnly = await post('/v1/app/auth/refresh', { refreshToken: idleShop.refreshToken });
    expect(idleOnly.statusCode).toBe(401);
    expect(idleOnly.json()).toEqual(day91.json());

    const staff = await loginStaff();
    let staffToken = staff.body.refreshToken;
    let staffCursor = Date.now();
    const staffAbsolute = new Date(staff.body.absoluteExpiresAt).getTime();
    while (staffCursor + 11 * 60 * 60 * 1000 < staffAbsolute) {
      staffCursor += 11 * 60 * 60 * 1000;
      clockAt = new Date(staffCursor);
      const step = await post('/v1/admin/auth/refresh', { refreshToken: staffToken });
      expect(step.statusCode).toBe(200);
      expect(step.json().absoluteExpiresAt).toBe(staff.body.absoluteExpiresAt);
      staffToken = step.json().refreshToken;
    }
    clockAt = new Date(staffAbsolute + 1000);
    const staffPast = await post('/v1/admin/auth/refresh', { refreshToken: staffToken });
    expect(staffPast.statusCode).toBe(401);
    expect(staffPast.json()).toEqual(day91.json());
    clockAt = new Date('2026-05-01T00:00:00.000Z');
    const graceStaff = await loginStaff();
    const rotatedAt = clockAt;
    const rotated = await post('/v1/admin/auth/refresh', {
      refreshToken: graceStaff.body.refreshToken,
    });
    expect(rotated.statusCode).toBe(200);
    clockAt = new Date(rotatedAt.getTime() + 1000);
    expect(
      (await post('/v1/admin/auth/refresh', { refreshToken: graceStaff.body.refreshToken }))
        .statusCode,
    ).toBe(200);
    clockAt = new Date(rotatedAt.getTime() + 12 * 60 * 60 * 1000 + 500);
    const graceIdle = await post('/v1/admin/auth/refresh', {
      refreshToken: rotated.json().refreshToken,
    });
    expect(graceIdle.statusCode).toBe(401);
    expect(graceIdle.json()).toEqual(day91.json());
    clockAt = undefined;
    const idleStaff = await loginStaff();
    clockAt = new Date(Date.now() + 12 * 60 * 60 * 1000 + 60 * 1000);
    expect(
      (await post('/v1/admin/auth/refresh', { refreshToken: idleStaff.body.refreshToken })).json(),
    ).toEqual(day91.json());
    const drv = await loginDriverUser();
    clockAt = new Date(Date.now() + 11 * 60 * 60 * 1000);
    const driverPast = await post('/v1/driver/auth/refresh', {
      refreshToken: drv.body.refreshToken,
    });
    expect(driverPast.json().error.code).toBe('UNAUTHENTICATED');
    expect(JSON.stringify(driverPast.json())).not.toContain('session_expired');
    clockAt = undefined;
  }, 60_000);

  it('B3 rechecks membership inside the lock and ignores ScopeDistributor', async () => {
    const staff = await loginStaff();
    const before = await tokenCount(staff.accountId);
    const scoped = await post(
      '/v1/admin/auth/refresh',
      { refreshToken: staff.body.refreshToken },
      { 'x-scope-distributor': DIST2 },
    );
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().staff.distributorId).toBe(DIST);
    await ownerPool.query(
      `UPDATE identity.staff_memberships SET distributor_id = $2 WHERE account_id = $1`,
      [staff.accountId, DIST2],
    );
    const moved = await post('/v1/admin/auth/refresh', {
      refreshToken: scoped.json().refreshToken,
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().staff.distributorId).toBe(DIST2);
    expect((await jwt.verify(moved.json().accessToken, 'staff')).did).toBe(DIST2);
    expect(await tokenCount(staff.accountId)).toBeGreaterThan(before);
    const flip = async (
      accountId: string,
      token: string,
      url: string,
      change: (client: pg.PoolClient) => Promise<unknown>,
    ) => {
      const count = await tokenCount(accountId);
      const holder = await identityPool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT set_config('lock_timeout', '15s', true)`);
        await holder.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [
          accountId,
        ]);
        const pending = post(url, { refreshToken: token });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await change(holder);
        await holder.query('COMMIT');
        const response = await pending;
        return { response, count };
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    };
    const deadDist = await loginStaff('distributor_admin', DIST);
    try {
      const paused = await flip(
        deadDist.accountId,
        deadDist.body.refreshToken,
        '/v1/admin/auth/refresh',
        () =>
          ownerPool.query(`UPDATE tenancy.distributors SET status = 'paused' WHERE id = $1`, [
            DIST,
          ]),
      );
      expect(paused.response.statusCode).toBe(401);
      expect(await tokenCount(deadDist.accountId)).toBe(paused.count);
    } finally {
      await ownerPool.query(`UPDATE tenancy.distributors SET status = 'active' WHERE id = $1`, [
        DIST,
      ]);
    }
    const removed = await loginStaff();
    const gone = await flip(
      removed.accountId,
      removed.body.refreshToken,
      '/v1/admin/auth/refresh',
      () =>
        ownerPool.query(`DELETE FROM identity.staff_memberships WHERE account_id = $1`, [
          removed.accountId,
        ]),
    );
    expect(gone.response.statusCode).toBe(401);
    expect(await tokenCount(removed.accountId)).toBe(gone.count);
    const inactiveStaff = await loginStaff();
    const inactive = await flip(
      inactiveStaff.accountId,
      inactiveStaff.body.refreshToken,
      '/v1/admin/auth/refresh',
      (client) =>
        client.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [
          inactiveStaff.accountId,
        ]),
    );
    expect(inactive.response.statusCode).toBe(401);
    expect(await tokenCount(inactiveStaff.accountId)).toBe(inactive.count);
    const roleStaff = await loginStaff();
    const roleCount = await tokenCount(roleStaff.accountId);
    const holder = await identityPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT set_config('lock_timeout', '15s', true)`);
      await holder.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [
        roleStaff.accountId,
      ]);
      const pending = post('/v1/admin/auth/refresh', { refreshToken: roleStaff.body.refreshToken });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await ownerPool.query(
        `UPDATE identity.staff_memberships SET role = 'super_admin', distributor_id = NULL WHERE account_id = $1`,
        [roleStaff.accountId],
      );
      await holder.query('COMMIT');
      const promoted = await pending;
      expect(promoted.statusCode).toBe(200);
      expect(promoted.json().staff.role).toBe('super_admin');
      expect(promoted.json().staff.distributorId ?? null).toBeNull();
      expect(claimsOf(promoted.json().accessToken).did).toBeUndefined();
      expect(await tokenCount(roleStaff.accountId)).toBe(roleCount + 1);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
    const shop = await loginShop();
    const shopFlip = await flip(shop.user.id, shop.refreshToken, '/v1/app/auth/refresh', (client) =>
      client.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [
        shop.user.id,
      ]),
    );
    expect(shopFlip.response.statusCode).toBe(401);
    expect(await tokenCount(shop.user.id)).toBe(shopFlip.count);
  }, 40_000);

  it('A4 uniform 200 revokes only the shopkeeper family; B4 revokes the caller sid', async () => {
    const shop = await loginShop();
    const other = await loginShop(shop.phone);
    const staff = await loginStaff();
    const otherStaff = { ...staff, body: await verifyStaff(staff.phone) };
    const drv = await loginDriverUser();
    const unknown = await post('/v1/app/auth/logout', { refreshToken: 'e'.repeat(43) });
    const garbage = await post('/v1/app/auth/logout', { refreshToken: ' '.repeat(43) });
    const rotated = await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken });
    expect(rotated.statusCode).toBe(200);
    const parentLogout = await post('/v1/app/auth/logout', { refreshToken: shop.refreshToken });
    const staffLogout = await post('/v1/app/auth/logout', {
      refreshToken: staff.body.refreshToken,
    });
    const driverLogout = await post('/v1/app/auth/logout', { refreshToken: drv.body.refreshToken });
    for (const row of [unknown, garbage, parentLogout, staffLogout, driverLogout]) {
      expect(row.statusCode).toBe(200);
      expect(row.body).toBe(unknown.body);
      expect(row.json()).toEqual({ status: 'ok' });
    }
    expect((await familyOf(shop.accessToken, 'shopkeeper')).revoked).toBe(true);
    expect(await actionCount(shop.user.id, 'refresh_reuse')).toBe('1');
    expect(
      (await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken })).statusCode,
    ).toBe(401);
    const current = await loginShop();
    const currentOut = await post('/v1/app/auth/logout', { refreshToken: current.refreshToken });
    expect(currentOut.body).toBe(unknown.body);
    expect(await actionCount(current.user.id, 'logout')).toBe('1');
    expect((await familyOf(staff.body.accessToken, 'staff')).revoked).toBe(false);
    expect((await familyOf(drv.body.accessToken, 'driver')).revoked).toBe(false);
    const started = Date.now();
    const deadAt = await authed('/v1/app/still-there', shop.accessToken);
    expect(deadAt.statusCode).toBe(401);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(
      (await post('/v1/app/auth/refresh', { refreshToken: other.refreshToken })).statusCode,
    ).toBe(200);
    const invalid = await post('/v1/app/auth/logout', { refreshToken: 'nope' });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');
    expect(invalid.body).not.toContain('nope');

    const revokedShop = await loginShop();
    const revokedOut = await post('/v1/app/auth/logout', {
      refreshToken: revokedShop.refreshToken,
    });
    const againRevoked = await post('/v1/app/auth/logout', {
      refreshToken: revokedShop.refreshToken,
    });
    expect(againRevoked.body).toBe(revokedOut.body);
    clockAt = new Date('2026-07-01T00:00:00.000Z');
    const expiredShop = await loginShop();
    clockAt = new Date(clockAt.getTime() + 31 * DAY);
    const expiredOut = await post('/v1/app/auth/logout', {
      refreshToken: expiredShop.refreshToken,
    });
    expect(expiredOut.body).toBe(unknown.body);
    clockAt = undefined;

    const samples = 30;
    const buckets = {
      valid: [] as string[],
      rotated: [] as string[],
      revoked: [] as string[],
      expired: [] as string[],
      unknown: [] as string[],
    };
    for (let i = 0; i < samples; i += 1) {
      buckets.valid.push((await loginShop()).refreshToken);
      const spun = await loginShop();
      expect(
        (await post('/v1/app/auth/refresh', { refreshToken: spun.refreshToken })).statusCode,
      ).toBe(200);
      buckets.rotated.push(spun.refreshToken);
      const dead = await loginShop();
      expect(
        (await post('/v1/app/auth/logout', { refreshToken: dead.refreshToken })).statusCode,
      ).toBe(200);
      buckets.revoked.push(dead.refreshToken);
      buckets.unknown.push(`${i}`.padEnd(43, 'u'));
    }
    clockAt = new Date('2026-08-01T00:00:00.000Z');
    const expiredBatch: string[] = [];
    for (let i = 0; i < samples; i += 1) expiredBatch.push((await loginShop()).refreshToken);
    clockAt = new Date(clockAt.getTime() + 31 * DAY);
    buckets.expired = expiredBatch;
    clockAt = undefined;
    const durations = {
      valid: [] as number[],
      rotated: [] as number[],
      revoked: [] as number[],
      expired: [] as number[],
      unknown: [] as number[],
    };
    const kinds = ['valid', 'rotated', 'revoked', 'expired', 'unknown'] as const;
    for (const kind of kinds) {
      for (const token of buckets[kind]) {
        const start = performance.now();
        const res = await post('/v1/app/auth/logout', { refreshToken: token });
        durations[kind].push(performance.now() - start);
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(unknown.body);
      }
    }
    const p95s = kinds.map((kind) => p95(durations[kind]));
    const slowest = Math.max(...p95s);
    const fastest = Math.min(...p95s);
    // A4 pads every 200 to 300ms. Tolerance: slowest p95 stays under 1.5× the fastest.
    expect(fastest).toBeGreaterThan(0);
    expect(slowest / fastest).toBeLessThan(1.5);

    const b4 = await post(
      '/v1/admin/auth/logout',
      {},
      { authorization: `Bearer ${staff.body.accessToken}` },
    );
    expect(b4.statusCode).toBe(200);
    expect(b4.json()).toEqual({ status: 'ok' });
    expect((await familyOf(staff.body.accessToken, 'staff')).revoked).toBe(true);
    const again = await post(
      '/v1/admin/auth/logout',
      {},
      { authorization: `Bearer ${staff.body.accessToken}` },
    );
    expect(again.statusCode).toBe(401);
    expect(again.statusCode).not.toBe(500);
    expect(
      (await post('/v1/admin/auth/refresh', { refreshToken: staff.body.refreshToken })).statusCode,
    ).toBe(401);
    const missingBearer = await post('/v1/admin/auth/logout', {});
    expect(missingBearer.statusCode).toBe(401);
    const extraBody = await post(
      '/v1/admin/auth/logout',
      { refreshToken: 'a'.repeat(43) },
      { authorization: `Bearer ${otherStaff.body.accessToken}` },
    );
    expect(extraBody.statusCode).toBe(422);
    expect(extraBody.body).not.toContain('a'.repeat(43));
    const live = await authed('/v1/admin/still-there', otherStaff.body.accessToken);
    expect(live.statusCode).toBe(404);
    const shopOnB4 = await post(
      '/v1/admin/auth/logout',
      {},
      { authorization: `Bearer ${other.accessToken}` },
    );
    expect(shopOnB4.statusCode).toBe(401);
    expect((await familyOf(other.accessToken, 'shopkeeper')).revoked).toBe(false);
    const sa = await loginStaff('super_admin', null);
    const badScope = await post(
      '/v1/admin/auth/logout',
      {},
      { authorization: `Bearer ${sa.body.accessToken}`, 'x-scope-distributor': 'not-a-uuid' },
    );
    expect(badScope.statusCode).toBe(200);
    expect((await familyOf(sa.body.accessToken, 'staff')).revoked).toBe(true);
    expect((await familyOf(otherStaff.body.accessToken, 'staff')).revoked).toBe(false);
    const driverOnB4 = await post(
      '/v1/admin/auth/logout',
      {},
      { authorization: `Bearer ${drv.body.accessToken}` },
    );
    expect(driverOnB4.statusCode).toBe(401);
    expect((await familyOf(drv.body.accessToken, 'driver')).revoked).toBe(false);
  }, 300_000);

  it('AUTH-AV-03/04 and drain failure: Redis down still refreshes; PG down is 503; deny failure still 401', async () => {
    const shop = await loginShop();
    const loggedOut = await loginShop();
    await redis.disconnect();
    try {
      expect(
        (await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken })).statusCode,
      ).toBe(200);
      expect(
        (await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken })).statusCode,
      ).toBe(200);
      const replay = await post('/v1/app/auth/refresh', { refreshToken: shop.refreshToken });
      expect(replay.statusCode).toBe(401);
      expect((await familyOf(shop.accessToken, 'shopkeeper')).revoked).toBe(true);
      const out = await post('/v1/app/auth/logout', { refreshToken: loggedOut.refreshToken });
      expect(out.statusCode).toBe(200);
      const pending = await ownerPool.query<{ done_at: Date | null }>(
        `SELECT done_at FROM identity.pending_session_denies WHERE sid = $1`,
        [(await familyOf(loggedOut.accessToken, 'shopkeeper')).sid],
      );
      expect(pending.rows[0]?.done_at ?? null).toBeNull();
      expect((await familyOf(loggedOut.accessToken, 'shopkeeper')).revoked).toBe(true);
    } finally {
      await redis.connect();
    }
    const real = otp.store;
    const down = Object.assign(new Error('db down'), { code: '57P01' });
    otp.store = {
      issue: (...args) => real.issue(...args),
      rotate: () => Promise.reject(down),
      logoutPresented: () => Promise.reject(down),
      logoutSid: (...args) => real.logoutSid(...args),
    };
    try {
      const before = await tokenCount(shop.user.id);
      const failed = await post('/v1/app/auth/refresh', { refreshToken: 'h'.repeat(43) });
      expect(failed.statusCode).toBe(503);
      expect(failed.headers['retry-after']).toBeTruthy();
      expect(await tokenCount(shop.user.id)).toBe(before);
    } finally {
      otp.store = real;
    }
    const staff = await loginStaff('super_admin', null);
    const failing = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: async () => {
        throw new Error('drain down');
      },
      log: silentDrainLog,
    });
    otp.store = failing;
    try {
      const out = await post(
        '/v1/admin/auth/logout',
        {},
        { authorization: `Bearer ${staff.body.accessToken}` },
      );
      expect(out.statusCode).toBe(200);
      const repeat = await post(
        '/v1/admin/auth/logout',
        {},
        { authorization: `Bearer ${staff.body.accessToken}` },
      );
      expect(repeat.statusCode).toBe(401);
      const audits = await ownerPool.query(
        `SELECT count(*)::text AS c FROM platform.audit_log
          WHERE actor_id = $1 AND action = 'logout'`,
        [staff.accountId],
      );
      const events = await ownerPool.query(
        `SELECT count(*)::text AS c FROM platform.outbox_events
          WHERE payload->>'accountId' = $1 AND payload->>'reason' = 'logout'`,
        [staff.accountId],
      );
      expect(audits.rows[0]?.c).toBe('1');
      expect(events.rows[0]?.c).toBe('1');
      const started = Date.now();
      let status = 0;
      // Live cache is 5s. One poll past that boundary still rejects inside the AUTH-RV-01 window.
      while (Date.now() - started < 6000) {
        status = (await authed('/v1/admin/still-there', staff.body.accessToken)).statusCode;
        if (status === 401) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(status).toBe(401);
      expect(Date.now() - started).toBeLessThan(6000);
    } finally {
      otp.store = real;
    }
    logs.length = 0;
    const captured = await loginShop();
    const staffLog = await loginStaff();
    const driverLog = await loginDriverUser();
    await authed('/v1/admin/still-there', staffLog.body.accessToken);
    const successor = (
      await post('/v1/app/auth/refresh', { refreshToken: captured.refreshToken })
    ).json().refreshToken as string;
    otp.store = {
      issue: (...args) => real.issue(...args),
      rotate: () =>
        Promise.resolve({
          status: 'rotated' as const,
          refreshToken: '',
          hash: 'h',
          sid: captured.user.id,
          familyId: captured.user.id,
          typ: 'shopkeeper' as const,
          accountId: captured.user.id,
          refreshExpiresAt: new Date(),
          absoluteExpiresAt: new Date(captured.absoluteExpiresAt),
          profile: {
            phone: captured.phone,
            isNewAccount: false,
            staffRole: null,
            distributorId: null,
            permissions: [],
            sessionVersion: 0,
            isDemo: false,
          },
        }),
      logoutPresented: (...args) => real.logoutPresented(...args),
      logoutSid: (...args) => real.logoutSid(...args),
    };
    try {
      const forced = await post('/v1/app/auth/refresh', { refreshToken: captured.refreshToken });
      expect(forced.statusCode).toBe(500);
    } finally {
      otp.store = real;
    }
    // The request lines carry no token field. This record is how the booted logger censors one.
    app.log.info(
      {
        refreshToken: captured.refreshToken,
        accessToken: staffLog.body.accessToken,
        authorization: `Bearer ${staffLog.body.accessToken}`,
        hash: hashRefreshToken(successor),
      },
      'redaction check',
    );
    const text = logs.join('');
    expect(text).toContain('[REDACTED]');
    for (const secret of [
      captured.refreshToken,
      successor,
      staffLog.body.refreshToken,
      staffLog.body.accessToken,
      driverLog.body.refreshToken,
      driverLog.body.accessToken,
      `Bearer ${staffLog.body.accessToken}`,
      hashRefreshToken(captured.refreshToken),
      hashRefreshToken(successor),
    ]) {
      expect(text).not.toContain(secret);
    }
  }, 60_000);
});
