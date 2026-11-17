import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { DriverAuthRuntime } from '../../src/modules/identity/application/driverAuth.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import {
  ipFailKey,
  limiterKeyPart,
  passwordChangeKey,
  unlockStaffKey,
  uipIndexKey,
  userFailKey,
  userIpFailKey,
  userIpLockKey,
  userLockKey,
} from '../../src/modules/identity/application/loginLimiter.js';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
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
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import { startPostgresWithRoles, type StartedPostgresRoles } from '../helpers/containers.js';

const DIST = '13131313-1313-4313-8313-131313131313';
const DIST2 = '14141414-1414-4414-8414-141414141414';
const TEMP = 'pw-drv-aaaaaa';
const REASON = 'lockout typo reset';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
let seq = 500000000;
const nextPhone = () => `+989${(seq += 1)}`;
const nextIp = () => `203.0.113.${(seq % 200) + 1}`;
const keyOf = () => `b83-key-${randomUUID()}`;

describe('Slice 3b B83 POST /v1/admin/drivers/{id}/unlock', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let app: App;
  let hasher: Argon2idPasswordHasher;
  let fake: FakeSmsProvider;
  let afterRespond: Promise<void> = Promise.resolve();
  const logLines: string[] = [];

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool({ connectionString: pgRoles.identityUrl });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
    const jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [await generateEd25519Key('k1')],
    });
    const authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    const store = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: (sids) => authority.deny(sids),
      log: silentDrainLog,
    });
    hasher = new Argon2idPasswordHasher();
    fake = new FakeSmsProvider({ capture: true });
    const shared = { identityPool, redis, jwt, authority, store };
    const otp: OtpAuthRuntime = {
      ...shared,
      sms: fake,
      log: silentDrainLog,
      pepper: TEST_OTP_HMAC_KEY,
      budget: { hour: 0, day: 0, skipBudget: true },
      runAfterRespond: (fn) => void (afterRespond = Promise.resolve(fn())),
    };
    const driverAuth: DriverAuthRuntime = {
      ...shared,
      hasher,
      log: silentDrainLog,
      auditHashKey: TEST_AUDIT_HASH_KEY,
    };
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at) VALUES ($1, 'D1', 'active', now()), ($2, 'D2', 'active', now())`,
      [DIST, DIST2],
    );
    app = await buildApp({
      config: testConfig({ REDIS_URL: redisBox.getConnectionUrl(), LOG_LEVEL: 'info' }),
      logDestination: { write: (line: string) => logLines.push(line) },
      healthChecks: [],
      verifier: jwt,
      sessionAuthority: authority,
      assertIssuance: () => assertRedisForAuthIssuance(redis),
      otpAuth: otp,
      driverAuth,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await redis.quit().catch(() => redis.disconnect());
    await identityPool.end();
    await ownerPool.end();
    await redisBox.stop();
    await pgRoles.postgres.stop();
  });

  const post = (url: string, payload: object = {}, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      payload,
    });

  const login = (username: string) => post('/v1/driver/auth/login', { username, password: TEMP });

  type UnlockOpts = { key?: string; body?: object; headers?: Record<string, string> };
  const unlock = (token: string, driverId: string, opts: UnlockOpts = {}) =>
    post(`/v1/admin/drivers/${driverId}/unlock`, opts.body ?? { reason: REASON }, {
      authorization: `Bearer ${token}`,
      'idempotency-key': opts.key ?? keyOf(),
      ...opts.headers,
    });

  async function seedStaff(
    role: 'super_admin' | 'distributor_admin',
    dist: string | null,
    perms: string[],
  ) {
    const accountId = randomUUID();
    const phone = nextPhone();
    await ownerPool.query(
      `INSERT INTO identity.accounts (id, typ, phone, status, session_version, must_change_password, created_at) VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions) VALUES ($1, $2, $3, $4)`,
      [accountId, role, dist, perms],
    );
    const keys = await redis.keys('otp:lim:*');
    if (keys.length > 0) await redis.del(...keys); // reset per-phone/IP OTP send limits
    const sent = await post('/v1/admin/auth/otp/send', { phone });
    await afterRespond;
    expect(sent.statusCode, sent.body).toBe(200);
    const code = fake.outbox.at(-1)?.code;
    expect(code).toMatch(/^[0-9]{6}$/);
    const verified = await post('/v1/admin/auth/otp/verify', { phone, code });
    expect(verified.statusCode, verified.body).toBe(200);
    return { accountId, accessToken: verified.json<{ accessToken: string }>().accessToken };
  }
  async function seedDriver(distributorId = DIST, status = 'active') {
    const accountId = randomUUID();
    const username = `drv-${randomUUID().slice(0, 8)}`;
    await ownerPool.query(
      `INSERT INTO identity.accounts (id, typ, phone, username_norm, status, session_version, must_change_password, created_at) VALUES ($1, 'driver', $2, $3, $4, 0, false, now())`,
      [accountId, nextPhone(), username, status],
    );
    await ownerPool.query(
      `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash, temp_expires_at) VALUES ($1, $2, $3, NULL)`,
      [accountId, distributorId, await hasher.hash(TEMP)],
    );
    return { accountId, username };
  }
  async function lockState(u: string, accountId: string) {
    const ip = nextIp();
    for (const key of [userLockKey(u), userIpFailKey(u, ip), userIpLockKey(u, ip)]) {
      await redis.set(key, '1', 'EX', 1800);
    }
    await redis.set(ipFailKey(ip), '4', 'EX', 900);
    await redis.set(passwordChangeKey(accountId), '2', 'EX', 900);
    await redis.sadd(uipIndexKey(u), limiterKeyPart(ip));
    await redis.expire(uipIndexKey(u), 3600);
    return ip;
  }

  const auditCount = async (driverId: string) =>
    (
      await ownerPool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM platform.audit_log WHERE action = 'driver_lockout_cleared' AND entity_id = $1`,
        [driverId],
      )
    ).rows[0]!.c;

  it('B83-01/02/06: clears only username/uip state; replay free; reuse 422; reason codes', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const token = staff.accessToken;
    const driver = await seedDriver();
    const u = driver.username;
    expect((await login(u)).statusCode).toBe(200);
    const live = await ownerPool.query<{ sid: string }>(
      `SELECT sid FROM identity.sessions WHERE account_id = $1 AND revoked_at IS NULL`,
      [driver.accountId],
    );
    const ip = await lockState(u, driver.accountId);
    const first = await unlock(token, driver.accountId);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const body = first.json();
    expect(body).toMatchObject({ driverId: driver.accountId, wasLocked: true, active: true });
    expect(Date.parse(body.lockedUntilBefore)).toBeGreaterThan(Date.now());
    for (const key of [
      userFailKey(u),
      userLockKey(u),
      userIpFailKey(u, ip),
      userIpLockKey(u, ip),
      uipIndexKey(u),
    ]) {
      expect(await redis.exists(key), key).toBe(0);
    }
    // Per-IP and LIM-C11-01 keys are not the unlock's business.
    expect(await redis.exists(ipFailKey(ip))).toBe(1);
    expect(await redis.exists(passwordChangeKey(driver.accountId))).toBe(1);
    expect(await auditCount(driver.accountId)).toBe('1');
    const limitKey = unlockStaffKey(staff.accountId);
    expect(await redis.get(limitKey)).toBe('1');
    // P6-1: the pre-existing live session survives and the next C1 login is 200.
    const alive = await ownerPool.query(
      `SELECT 1 FROM identity.sessions WHERE sid = $1 AND revoked_at IS NULL`,
      [live.rows[0]!.sid],
    );
    expect(alive.rowCount).toBe(1);
    expect((await login(u)).statusCode).toBe(200);
    // B83-02: a no-op is audited and counted; replay and reuse of one key.
    const key = keyOf();
    const noop = await unlock(token, driver.accountId, { key });
    expect(noop.json()).toMatchObject({ wasLocked: false, lockedUntilBefore: null, active: true });
    expect([await redis.get(limitKey), await auditCount(driver.accountId)]).toEqual(['2', '2']);
    const replay = await unlock(token, driver.accountId, { key });
    expect(replay.json()).toEqual(noop.json());
    expect([await redis.get(limitKey), await auditCount(driver.accountId)]).toEqual(['2', '2']);
    const reuse = await unlock(token, driver.accountId, { key, body: { reason: 'typo again' } });
    expect(reuse.statusCode).toBe(422);
    expect(reuse.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSE' } });
    const cases: [object, string][] = [
      [{}, 'REASON_REQUIRED'],
      [{ reason: 'ab' }, 'REASON_REQUIRED'],
      [{ reason: 'a'.repeat(501) }, 'REASON_TOO_LONG'],
    ];
    for (const [payload, code] of cases) {
      const response = await unlock(token, driver.accountId, { body: payload });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toMatchObject({ error: { code } });
    }
    const tooLong = await unlock(token, driver.accountId, { body: { reason: 'a'.repeat(501) } });
    expect(tooLong.json()).toMatchObject({ error: { details: { max: 500 } } });
  });

  it('B83-03/04/503: tenant 404s identical; authz/scope/key; inactive; Redis down 503', async () => {
    const da = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const noPerm = await seedStaff('distributor_admin', DIST, ['staff.manage']);
    const sa = await seedStaff('super_admin', null, []);
    const own = await seedDriver(DIST);
    const foreign = await seedDriver(DIST2);
    const drvToken = (await login(foreign.username)).json<{ accessToken: string }>().accessToken;
    const foreignRes = await unlock(da.accessToken, foreign.accountId);
    const unknownRes = await unlock(da.accessToken, randomUUID());
    expect([foreignRes.statusCode, unknownRes.statusCode]).toEqual([404, 404]);
    expect(foreignRes.body).toBe(unknownRes.body);
    expect(foreignRes.json()).toEqual(NOT_FOUND);
    expect(foreignRes.headers['cache-control']).toBe('no-store');
    expect((await unlock(noPerm.accessToken, own.accountId)).statusCode).toBe(403);
    expect((await unlock(drvToken, own.accountId)).statusCode).toBe(401);
    const scoped = await unlock(sa.accessToken, own.accountId, {
      headers: { 'x-scope-distributor': DIST },
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const crossed = await unlock(da.accessToken, foreign.accountId, {
      headers: { 'x-scope-distributor': DIST2 },
    });
    expect(crossed.statusCode).toBe(404);
    const platform = await unlock(sa.accessToken, own.accountId);
    expect(platform.statusCode).toBe(400);
    expect(platform.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    const missingKey = await post(
      `/v1/admin/drivers/${own.accountId}/unlock`,
      { reason: REASON },
      { authorization: `Bearer ${da.accessToken}` },
    );
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    const inactive = await seedDriver(DIST, 'inactive');
    const cleared = await unlock(da.accessToken, inactive.accountId);
    expect(cleared.json()).toMatchObject({ active: false, wasLocked: false });
    const refused = await login(inactive.username);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
    // Redis down on the limiter path is 503, and logs never carry secrets.
    const driver = await seedDriver();
    const joined = logLines.join('');
    expect(joined).not.toContain(driver.username);
    expect(joined).not.toContain(TEMP);
    expect(joined).not.toContain(da.accessToken);
    const real = app.otpAuth!.redis;
    const down = { status: 'close', connect: () => Promise.reject(new Error('down')) };
    (app.otpAuth as { redis: unknown }).redis = down;
    try {
      const response = await unlock(da.accessToken, driver.accountId);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      (app.otpAuth as { redis: unknown }).redis = real;
    }
  });
  it('B83-05: 11th staff / 4th driver unlock in 1h are 429; no-ops count', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    for (let n = 0; n < 10; n += 1) {
      expect((await unlock(staff.accessToken, (await seedDriver()).accountId)).statusCode).toBe(
        200,
      );
    }
    const staffLimited = await unlock(staff.accessToken, (await seedDriver()).accountId);
    expect(staffLimited.statusCode).toBe(429);
    expect(staffLimited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    const staffB = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const driver = await seedDriver();
    for (let n = 0; n < 3; n += 1) {
      expect((await unlock(staffB.accessToken, driver.accountId)).statusCode).toBe(200);
    }
    const limited = await unlock(staffB.accessToken, driver.accountId);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
