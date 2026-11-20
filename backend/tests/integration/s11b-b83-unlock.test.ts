import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { DriverAuthRuntime } from '../../src/modules/identity/application/driverAuth.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import {
  ipFailKey,
  limiterKeyPart,
  passwordChangeKey,
  tarpitKey,
  unlockDriverKey,
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
  type DrainLog,
} from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { FakeSmsProvider } from '../../src/modules/notification/infra/sms/fakeSmsProvider.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { TEST_AUDIT_HASH_KEY, TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import {
  startPostgresWithRoles,
  startRedis,
  type StartedPostgresRoles,
  type StartedTestRedis,
} from '../helpers/containers.js';
const DIST = '13131313-1313-4313-8313-131313131313';
const DIST2 = '14141414-1414-4414-8414-141414141414';
const TEMP = 'pw-drv-aaaaaa';
const WRONG = 'wrong-password-99';
const REASON = 'lockout typo reset';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
const REASON_ENVELOPE = {
  error: { code: 'REASON_TOO_LONG', message: 'Reason is too long', details: { max: 500 } },
};
const DOWN = { status: 'close', connect: () => Promise.reject(new Error('down')) };
let seq = 500000000;
const nextPhone = () => `+989${(seq += 1)}`;
const nextIp = () => `203.0.113.${(seq % 200) + 1}`;
const keyOf = () => `b83-key-${randomUUID()}`;
const AUDIT_COUNT = `SELECT count(*)::text AS c FROM platform.audit_log WHERE action = 'driver_lockout_cleared' AND entity_id = $1`;
describe('Slice 3b B83 POST /v1/admin/drivers/{id}/unlock', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedTestRedis;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let app: App;
  let hasher: Argon2idPasswordHasher;
  let fake: FakeSmsProvider;
  let afterRespond: Promise<void> = Promise.resolve();
  const logLines: string[] = [];
  // Application drain log (not the pino destination), so unlock alerts are observable.
  const drain: DrainLog = {
    error: (bindings, msg) => logLines.push(JSON.stringify({ ...bindings, msg })),
    warn: (bindings, msg) => logLines.push(JSON.stringify({ ...bindings, msg })),
    info: (bindings, msg) => logLines.push(JSON.stringify({ ...bindings, msg })),
  };
  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await startRedis();
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
    const onSidsRevoked = (sids: readonly string[]) => authority.deny(sids);
    const store = new PgRefreshTokenStore(identityPool, { onSidsRevoked, log: drain });
    hasher = new Argon2idPasswordHasher();
    fake = new FakeSmsProvider({ capture: true });
    const shared = { identityPool, redis, jwt, authority, store };
    const otp: OtpAuthRuntime = {
      ...shared,
      sms: fake,
      log: drain,
      pepper: TEST_OTP_HMAC_KEY,
      budget: { hour: 0, day: 0, skipBudget: true },
      runAfterRespond: (fn) => void (afterRespond = Promise.resolve(fn())),
    };
    const driverAuth: DriverAuthRuntime = {
      ...shared,
      hasher,
      log: drain,
      auditHashKey: TEST_AUDIT_HASH_KEY,
    };
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at) VALUES ($1, 'D1', 'active', now()), ($2, 'D2', 'active', now())`,
      [DIST, DIST2],
    );
    app = await buildApp({
      config: testConfig({
        REDIS_URL: redisBox.getConnectionUrl(),
        LOG_LEVEL: 'info',
        TRUST_PROXY_HOPS: '1',
      }),
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
  const login = (username: string, password = TEMP, ip?: string) =>
    post('/v1/driver/auth/login', { username, password }, ip ? { 'x-forwarded-for': ip } : {});
  type UnlockOpts = { key?: string; body?: object; headers?: Record<string, string> };
  const scopeOf = (dist: string) => ({ 'x-scope-distributor': dist });
  const unlock = (token: string, driverId: string, opts: UnlockOpts = {}) =>
    post(`/v1/admin/drivers/${driverId}/unlock`, opts.body ?? { reason: REASON }, {
      authorization: `Bearer ${token}`,
      'idempotency-key': opts.key ?? keyOf(),
      ...opts.headers,
    });
  /** The five per-username keys an unlock must clear: user + user/IP fail and lock. */
  const uipKeys = (u: string, ip: string) => [
    userFailKey(u),
    userLockKey(u),
    userIpFailKey(u, ip),
    userIpLockKey(u, ip),
  ];

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
    for (const key of uipKeys(u, ip)) await redis.set(key, '1', 'EX', 1800);
    await redis.set(ipFailKey(ip), '4', 'EX', 900);
    await redis.set(passwordChangeKey(accountId), '2', 'EX', 900);
    await redis.sadd(uipIndexKey(u), limiterKeyPart(ip));
    await redis.expire(uipIndexKey(u), 3600);
    return ip;
  }
  const auditCount = async (driverId: string) =>
    (await ownerPool.query<{ c: string }>(AUDIT_COUNT, [driverId])).rows[0]!.c;
  const alerts = () => logLines.filter((line) => line.includes('"driver_unlock_repeat_alert"'));

  it('B83-01/02/06 + P7-1: clears only username/uip state; replay free; reuse 422; reason codes', async () => {
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
    const lockedKey = keyOf();
    const first = await unlock(token, driver.accountId, { key: lockedKey });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const body = first.json();
    expect(body).toMatchObject({ driverId: driver.accountId, wasLocked: true, active: true });
    expect(Date.parse(body.lockedUntilBefore)).toBeGreaterThan(Date.now());
    for (const key of uipKeys(u, ip)) expect(await redis.exists(key), key).toBe(0);
    // Per-IP and LIM-C11-01 keys are not the unlock's business.
    expect(await redis.exists(ipFailKey(ip), passwordChangeKey(driver.accountId))).toBe(2);
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
    const counted = () => Promise.all([redis.get(limitKey), auditCount(driver.accountId)]);
    expect(await counted()).toEqual(['2', '2']);
    expect((await unlock(token, driver.accountId, { key })).json()).toEqual(noop.json());
    expect(await counted()).toEqual(['2', '2']);
    const reuse = await unlock(token, driver.accountId, { key, body: { reason: 'typo again' } });
    expect(reuse.statusCode).toBe(422);
    expect(reuse.json().error.code).toBe('IDEMPOTENCY_KEY_REUSE');
    for (const [payload, code] of [
      [{}, 'REASON_REQUIRED'],
      [{ reason: 'ab' }, 'REASON_REQUIRED'],
      [{ reason: 'a'.repeat(501) }, 'REASON_TOO_LONG'],
    ] as [object, string][]) {
      const response = await unlock(token, driver.accountId, { body: payload });
      expect([response.statusCode, response.json().error.code], response.body).toEqual([422, code]);
    }
    const tooLong = await unlock(token, driver.accountId, { body: { reason: 'a'.repeat(501) } });
    expect([tooLong.statusCode, tooLong.json()]).toEqual([422, REASON_ENVELOPE]);
    // P7-1: replaying a committed key is a pure 200 — it must not clear a driver locked since.
    const ip2 = await lockState(u, driver.accountId);
    for (let n = 0; n < 5; n += 1) {
      const again = await unlock(token, driver.accountId, { key: lockedKey });
      expect([again.statusCode, again.json()], again.body).toEqual([200, body]);
    }
    expect(await redis.exists(...uipKeys(u, ip2), uipIndexKey(u))).toBe(5);
    expect(await counted()).toEqual(['2', '2']);
  });

  it('B83-03/04/503 + P7-2a/P7-3: tenant 404s identical; authz/scope/key; audit failure rolls back', async () => {
    const da = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const noPerm = await seedStaff('distributor_admin', DIST, ['staff.manage']);
    const sa = await seedStaff('super_admin', null, []);
    const own = await seedDriver(DIST);
    const foreign = await seedDriver(DIST2);
    const drvToken = (await login(foreign.username)).json<{ accessToken: string }>().accessToken;
    const unknownId = randomUUID();
    const foreignRes = await unlock(da.accessToken, foreign.accountId);
    const unknownRes = await unlock(da.accessToken, unknownId);
    expect([foreignRes.statusCode, unknownRes.statusCode]).toEqual([404, 404]);
    expect(foreignRes.body).toBe(unknownRes.body);
    expect(foreignRes.json()).toEqual(NOT_FOUND);
    expect(foreignRes.headers['cache-control']).toBe('no-store');
    // P7-2d: both 404s happen before the limiter, so no counter or audit row exists.
    const untouched = [
      unlockStaffKey(da.accountId),
      unlockDriverKey(foreign.accountId),
      unlockDriverKey(unknownId),
    ];
    expect(await redis.exists(...untouched)).toBe(0);
    expect((await unlock(noPerm.accessToken, own.accountId)).statusCode).toBe(403);
    expect((await unlock(drvToken, own.accountId)).statusCode).toBe(401);
    const scoped = await unlock(sa.accessToken, own.accountId, { headers: scopeOf(DIST) });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const crossed = await unlock(da.accessToken, foreign.accountId, { headers: scopeOf(DIST2) });
    expect(crossed.statusCode).toBe(404);
    const platform = await unlock(sa.accessToken, own.accountId);
    expect(platform.statusCode).toBe(400);
    expect(platform.json().error.code).toBe('VALIDATION_FAILED');
    const missingKey = await post(
      `/v1/admin/drivers/${own.accountId}/unlock`,
      { reason: REASON },
      { authorization: `Bearer ${da.accessToken}` },
    );
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const inactive = await seedDriver(DIST, 'inactive');
    const cleared = await unlock(da.accessToken, inactive.accountId);
    expect(cleared.json()).toMatchObject({ active: false, wasLocked: false });
    const refused = await login(inactive.username);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe('invalid_credentials');
    // P7-2a: an audit INSERT failure aborts effect + completion, and the keys stay locked.
    const audited = await seedDriver();
    const auditKey = keyOf();
    const auditedIp = await lockState(audited.username, audited.accountId);
    await ownerPool.query(
      `CREATE FUNCTION b83_audit_down() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit down'; END$$;
       CREATE TRIGGER b83_audit_down BEFORE INSERT ON platform.audit_log FOR EACH ROW
       WHEN (NEW.entity_id = '${audited.accountId}') EXECUTE FUNCTION b83_audit_down()`,
    );
    try {
      const failed = await unlock(da.accessToken, audited.accountId, { key: auditKey });
      expect(failed.statusCode, failed.body).toBeGreaterThanOrEqual(500);
    } finally {
      await ownerPool.query(
        `DROP TRIGGER IF EXISTS b83_audit_down ON platform.audit_log; DROP FUNCTION IF EXISTS b83_audit_down()`,
      );
    }
    const lockedKeys = [...uipKeys(audited.username, auditedIp), uipIndexKey(audited.username)];
    expect(await redis.exists(...lockedKeys)).toBe(5);
    expect(await auditCount(audited.accountId)).toBe('0');
    const pending = await ownerPool.query<{ status_code: number | null }>(
      `SELECT status_code FROM platform.idempotency_keys WHERE scope = $1 AND key = $2`,
      [`B83:${audited.accountId}`, auditKey],
    );
    expect(pending.rows[0]?.status_code).toBeNull();
    // P7-3: abandon leaves the row takeable, so the same key is not 409 for 30s.
    const retried = await unlock(da.accessToken, audited.accountId, { key: auditKey });
    expect(retried.statusCode, retried.body).toBe(200);
    // Redis down on the limiter path is 503, and logs never carry secrets.
    const driver = await seedDriver();
    const joined = logLines.join('');
    expect(joined).not.toContain(driver.username);
    expect(joined).not.toContain(TEMP);
    expect(joined).not.toContain(da.accessToken);
    const real = app.otpAuth!.redis;
    const downKey = keyOf();
    (app.otpAuth as { redis: unknown }).redis = DOWN;
    try {
      const response = await unlock(da.accessToken, driver.accountId, { key: downKey });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      (app.otpAuth as { redis: unknown }).redis = real;
    }
    // P7-3: the abandoned key is retryable, not 409.
    expect((await unlock(da.accessToken, driver.accountId, { key: downKey })).statusCode).toBe(200);
  });

  it('B83-05 + P7-2b/P7-2c: 10/h staff, 3/h driver, repeat alert, real C1 lockout', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    for (let n = 0; n < 10; n += 1) {
      const target = (await seedDriver()).accountId;
      expect((await unlock(staff.accessToken, target)).statusCode).toBe(200);
    }
    const staffLimited = await unlock(staff.accessToken, (await seedDriver()).accountId);
    expect(staffLimited.statusCode).toBe(429);
    expect(staffLimited.json().error.code).toBe('RATE_LIMITED');
    const staffB = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const driver = await seedDriver();
    // P7-2b: the third unlock of one driver raises one alert carrying ids only.
    for (let n = 0; n < 3; n += 1) {
      expect((await unlock(staffB.accessToken, driver.accountId)).statusCode).toBe(200);
      expect(alerts().length).toBe(n === 2 ? 1 : 0);
    }
    expect(JSON.parse(alerts()[0]!)).toEqual({
      driverId: driver.accountId,
      staffId: staffB.accountId,
      msg: 'driver_unlock_repeat_alert',
    });
    const limited = await unlock(staffB.accessToken, driver.accountId);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // P7-2c/P7-10a: 3 fails from IP A + 2 from IP B lock the account. Unlock clears only
    // username+uip state; per-IP fail counters, tarpit and C11 keys survive.
    const victim = await seedDriver();
    const u = victim.username;
    const [ipA, ipB] = [nextIp(), nextIp()];
    for (const ip of [ipA, ipB]) await redis.set(tarpitKey(ip), '1', 'EX', 60);
    await redis.set(passwordChangeKey(victim.accountId), '2', 'EX', 900);
    for (let n = 0; n < 3; n += 1)
      expect((await login(victim.username, WRONG, ipA)).statusCode).toBe(401);
    for (let n = 0; n < 2; n += 1)
      expect((await login(victim.username, WRONG, ipB)).statusCode).toBe(401);
    const lockedOut = await login(victim.username, WRONG, ipA);
    expect([lockedOut.statusCode, lockedOut.json().error.code]).toEqual([429, 'too_many_attempts']);
    const unlocked = await unlock(staffB.accessToken, victim.accountId);
    expect(unlocked.json()).toMatchObject({ wasLocked: true, active: true });
    const gone = [
      userFailKey(u),
      userLockKey(u),
      uipIndexKey(u),
      userIpFailKey(u, ipA),
      userIpLockKey(u, ipA),
      userIpFailKey(u, ipB),
      userIpLockKey(u, ipB),
    ];
    expect(await redis.exists(...gone)).toBe(0);
    const survive = [
      ipFailKey(ipA),
      ipFailKey(ipB),
      tarpitKey(ipA),
      tarpitKey(ipB),
      passwordChangeKey(victim.accountId),
    ];
    for (const key of survive) expect(await redis.exists(key), key).toBe(1);
    expect((await login(u, TEMP, ipA)).statusCode).toBe(200);
    expect((await login(u, TEMP, ipB)).statusCode).toBe(200);
    expect(await redis.exists(ipFailKey(ipA), ipFailKey(ipB))).toBe(2);
  });
  it('P7-9 + L-7-2: DEL failure stores a 503; replays are Redis-free; new key recovers', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const driver = await seedDriver();
    const ip = await lockState(driver.username, driver.accountId);
    const key = keyOf();
    const staffKey = unlockStaffKey(staff.accountId);
    const real = app.otpAuth!.redis;
    const del = real.del;
    (real as { del: unknown }).del = () => Promise.reject(new Error('del down'));
    const first = await unlock(staff.accessToken, driver.accountId, { key });
    (real as { del: unknown }).del = del;
    const envelope = {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
        details: { retryAfter: 5 },
      },
    };
    expect([first.statusCode, first.json()], first.body).toEqual([503, envelope]);
    const row = await ownerPool.query<{ status_code: number | null; response: unknown }>(
      `SELECT status_code, response FROM platform.idempotency_keys
        WHERE scope = $1 AND subject_id = $2 AND key = $3`,
      [`B83:${driver.accountId}`, staff.accountId, key],
    );
    expect(row.rows[0]?.status_code).toBe(503);
    expect(row.rows[0]?.response).toEqual(envelope);
    const clearLogs = logLines.filter((line) => line.includes('driver_unlock_redis_clear_failed'));
    expect(JSON.parse(clearLogs[0]!)).toEqual({
      driverId: driver.accountId,
      staffId: staff.accountId,
      msg: 'driver_unlock_redis_clear_failed',
    });
    for (const secret of [driver.username, ip, REASON, staff.accessToken]) {
      expect(clearLogs.join('')).not.toContain(secret);
    }
    // The completed 503 path makes zero Redis calls across five replays.
    let hits = 0;
    (app.otpAuth as { redis: unknown }).redis = new Proxy(real, {
      get(target, prop) {
        hits += 1;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    for (let n = 0; n < 5; n += 1) {
      const again = await unlock(staff.accessToken, driver.accountId, { key });
      expect([again.statusCode, again.body]).toEqual([503, first.body]);
    }
    (app.otpAuth as { redis: unknown }).redis = real;
    expect(hits).toBe(0);
    const locks = [...uipKeys(driver.username, ip), uipIndexKey(driver.username)];
    expect(await redis.exists(...locks)).toBe(5);
    expect(await auditCount(driver.accountId)).toBe('1');
    expect(await redis.get(staffKey)).toBe('1');
    expect(await redis.get(unlockDriverKey(driver.accountId))).toBe('1');
    // A new key clears, counts and audits; a completed 200 replays with Redis down.
    const freshKey = keyOf();
    const fresh = await unlock(staff.accessToken, driver.accountId, { key: freshKey });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(await redis.exists(...locks)).toBe(0);
    expect(await auditCount(driver.accountId)).toBe('2');
    expect(await redis.get(staffKey)).toBe('2');
    (app.otpAuth as { redis: unknown }).redis = DOWN;
    const replay = await unlock(staff.accessToken, driver.accountId, { key: freshKey });
    (app.otpAuth as { redis: unknown }).redis = real;
    expect([replay.statusCode, replay.json()]).toEqual([200, fresh.json()]);
  });
  it('P7-9: DEL + downgrade failure keeps the 200 row; replay is the stored 200', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const driver = await seedDriver();
    await lockState(driver.username, driver.accountId);
    const key = keyOf();
    const real = app.otpAuth!.redis;
    const del = real.del;
    await ownerPool.query(
      `CREATE FUNCTION b83_idem_down() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'idem down'; END$$;
       CREATE TRIGGER b83_idem_down BEFORE UPDATE ON platform.idempotency_keys FOR EACH ROW
       WHEN (NEW.status_code = 503) EXECUTE FUNCTION b83_idem_down()`,
    );
    (real as { del: unknown }).del = () => Promise.reject(new Error('del down'));
    let first;
    try {
      first = await unlock(staff.accessToken, driver.accountId, { key });
    } finally {
      (real as { del: unknown }).del = del;
      await ownerPool.query(
        `DROP TRIGGER IF EXISTS b83_idem_down ON platform.idempotency_keys;
         DROP FUNCTION IF EXISTS b83_idem_down()`,
      );
    }
    expect(first.statusCode, first.body).toBe(503);
    const row = await ownerPool.query<{ status_code: number | null }>(
      `SELECT status_code FROM platform.idempotency_keys
        WHERE scope = $1 AND subject_id = $2 AND key = $3`,
      [`B83:${driver.accountId}`, staff.accountId, key],
    );
    expect(row.rows[0]?.status_code).toBe(200);
    const downgrade = logLines
      .map((line) => JSON.parse(line))
      .filter((line) => line.msg === 'idempotency_downgrade_failed');
    expect(downgrade).toEqual([
      { driverId: driver.accountId, staffId: staff.accountId, msg: 'idempotency_downgrade_failed' },
    ]);
    // Accepted residual: the failed downgrade leaves the stored 200 to replay with no Redis.
    (app.otpAuth as { redis: unknown }).redis = DOWN;
    const replay = await unlock(staff.accessToken, driver.accountId, { key });
    (app.otpAuth as { redis: unknown }).redis = real;
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      driverId: driver.accountId,
      wasLocked: true,
      active: true,
    });
  });
  it('P7-5: user agent is audit-only, control-stripped and capped', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const ua = async (driverId: string) =>
      (
        await ownerPool.query<{ ua: string | null }>(
          `SELECT data->>'userAgent' AS ua FROM platform.audit_log
            WHERE action = 'driver_lockout_cleared' AND entity_id = $1`,
          [driverId],
        )
      ).rows[0]!.ua;
    const missing = await seedDriver();
    const noUa = await unlock(staff.accessToken, missing.accountId, {
      headers: { 'user-agent': '' },
    });
    expect(noUa.statusCode, noUa.body).toBe(200);
    expect(await ua(missing.accountId)).toBeNull();
    const capped = await seedDriver();
    const key = keyOf();
    const raw = `raw-ua-probe\r\nSECRET${'🦊'.repeat(300)}`;
    const response = await unlock(staff.accessToken, capped.accountId, {
      key,
      headers: { 'user-agent': raw },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain('userAgent');
    const stored = await ua(capped.accountId);
    expect(stored ?? '').not.toMatch(/\p{Cc}/u);
    expect(Array.from(stored!)).toHaveLength(256);
    const idem = await ownerPool.query(
      `SELECT response FROM platform.idempotency_keys WHERE scope = $1 AND subject_id = $2 AND key = $3`,
      [`B83:${capped.accountId}`, staff.accountId, key],
    );
    expect(JSON.stringify(idem.rows[0])).not.toContain('userAgent');
    expect(logLines.join('')).not.toContain('SECRET');
  });
  it('L-7-1: refunds only non-committed reservations; caps survive rollback loops', async () => {
    const staff = await seedStaff('distributor_admin', DIST, ['drivers.manage']);
    const staffKey = unlockStaffKey(staff.accountId);
    const count = async (key: string) => Number((await redis.get(key)) ?? 0);
    const auditDown = (name: string, condition: string) =>
      ownerPool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit down'; END$$;
         CREATE TRIGGER ${name} BEFORE INSERT ON platform.audit_log FOR EACH ROW
         WHEN (${condition}) EXECUTE FUNCTION ${name}()`,
      );
    const dropAuditDown = (name: string) =>
      ownerPool.query(
        `DROP TRIGGER IF EXISTS ${name} ON platform.audit_log; DROP FUNCTION IF EXISTS ${name}()`,
      );
    const failed = async (driverId: string) =>
      expect((await unlock(staff.accessToken, driverId)).statusCode).toBeGreaterThanOrEqual(500);
    const driver = await seedDriver();
    await auditDown('b83_refund_audit', `NEW.entity_id = '${driver.accountId}'`);
    try {
      await failed(driver.accountId);
      expect(await count(staffKey)).toBe(0);
      expect(await count(unlockDriverKey(driver.accountId))).toBe(0);
      for (const key of [staffKey, unlockDriverKey(driver.accountId)])
        expect(await redis.ttl(key)).not.toBe(-1);
      // Four forced rollbacks on this driver cannot exhaust its 3/h cap.
      for (let n = 0; n < 3; n += 1) await failed(driver.accountId);
    } finally {
      await dropAuditDown('b83_refund_audit');
    }
    for (let n = 0; n < 3; n += 1)
      expect((await unlock(staff.accessToken, driver.accountId)).statusCode).toBe(200);
    expect((await unlock(staff.accessToken, driver.accountId)).statusCode).toBe(429);
    // Eleven forced rollbacks by one staff cannot exhaust the 10/h staff cap.
    await auditDown('b83_refund_staff', `NEW.actor_id = '${staff.accountId}'`);
    try {
      for (let n = 0; n < 11; n += 1) await failed((await seedDriver()).accountId);
    } finally {
      await dropAuditDown('b83_refund_staff');
    }
    expect((await unlock(staff.accessToken, (await seedDriver()).accountId)).statusCode).toBe(200);
    // Committed successes are never refunded; a real 429 stays counted at 11.
    expect(await count(staffKey)).toBe(5);
    for (let n = 0; n < 5; n += 1)
      expect((await unlock(staff.accessToken, (await seedDriver()).accountId)).statusCode).toBe(
        200,
      );
    expect(await count(staffKey)).toBe(10);
    expect((await unlock(staff.accessToken, (await seedDriver()).accountId)).statusCode).toBe(429);
    expect(await count(staffKey)).toBe(11);
  });
});
