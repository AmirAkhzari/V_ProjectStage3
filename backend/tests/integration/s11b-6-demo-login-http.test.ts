import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { pino } from 'pino';
import { buildApp, type App } from '../../src/app.js';
import { seedDemoLogin } from '../../scripts/seed-demo.js';
import type { DriverAuthRuntime } from '../../src/modules/identity/application/driverAuth.js';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import {
  DEMO_DISTRIBUTOR_ID,
  DEMO_SHOPKEEPER_ID,
  DEMO_SHOPKEEPER_PHONE,
  DEMO_STAFF_ID,
  DEMO_STAFF_PHONE,
} from '../../src/modules/identity/domain/demoAccounts.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import { PgSessionStore } from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { FakeSmsProvider } from '../../src/modules/notification/infra/sms/fakeSmsProvider.js';
import { DEMO_AUD, DEMO_ISS } from '../../src/platform/auth/demoLogin.js';
import { DemoAwareTokens } from '../../src/platform/auth/demoTokens.js';
import {
  EddsaAccessTokenService,
  generateEd25519Key,
  type Ed25519SigningKey,
} from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { JWT_ALG, JWT_TYP } from '../../src/platform/auth/jwt.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { TEST_AUDIT_HASH_KEY, TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';
import { pinoOptions } from '../../src/platform/logger.js';
import { createRedis } from '../../src/platform/redis.js';
import { productionApiConfig, testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const REAL_DIST = '44444444-4444-4444-8444-444444444444';
const DEMO_DRIVER = '03000000-0000-4000-8000-000000000099';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };

describe('S11b-6 demo login HTTP', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let tokens: DemoAwareTokens;
  let prodKey: Ed25519SigningKey;
  let demoKey: Ed25519SigningKey;
  let fake: FakeSmsProvider;
  let otp: OtpAuthRuntime;
  let app: App;
  let afterRespond: Promise<void> = Promise.resolve();

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool({ connectionString: pgRoles.identityUrl });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    appPool = new pg.Pool({ connectionString: pgRoles.appUrl });
    attachPgTeardownGuard(identityPool);
    attachPgTeardownGuard(ownerPool);
    attachPgTeardownGuard(appPool);
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
    prodKey = await generateEd25519Key('k-prod');
    demoKey = await generateEd25519Key('k-demo');
    const prod = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k-prod',
      keys: [prodKey],
    });
    const demo = new EddsaAccessTokenService({
      iss: DEMO_ISS,
      activeKid: 'k-demo',
      keys: [demoKey],
      audience: DEMO_AUD,
    });
    tokens = new DemoAwareTokens(prod, demo, 'k-demo');
    const authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    fake = new FakeSmsProvider({ capture: true });
    const log = pino(pinoOptions({ LOG_LEVEL: 'silent' }));
    const store = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: (sids) => authority.deny(sids),
      log,
    });
    otp = {
      identityPool,
      redis,
      jwt: tokens,
      authority,
      store,
      sms: fake,
      log,
      pepper: TEST_OTP_HMAC_KEY,
      budget: { hour: 0, day: 0, skipBudget: true },
      demoLogin: true,
      runAfterRespond: (fn) => {
        afterRespond = Promise.resolve(fn());
      },
    };
    const driver: DriverAuthRuntime = {
      identityPool,
      redis,
      jwt: tokens,
      authority,
      store,
      hasher: new Argon2idPasswordHasher(),
      log,
      auditHashKey: TEST_AUDIT_HASH_KEY,
      limiter: { tarpitAfter: 100 },
    };
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'Real distributor', 'active', now())`,
      [REAL_DIST],
    );
    await seedDemoLogin(ownerPool);
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, username_norm, status, session_version, must_change_password, is_demo, created_at)
       VALUES ($1, 'driver', 'demodriver', 'active', 0, false, true, now())`,
      [DEMO_DRIVER],
    );
    await ownerPool.query(
      `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash)
       VALUES ($1, $2, 'not-a-real-hash')`,
      [DEMO_DRIVER, DEMO_DISTRIBUTOR_ID],
    );
    app = await buildApp({
      config: testConfig({
        TRUST_PROXY_HOPS: '1',
        DEMO_LOGIN_ENABLED: 'true',
        LOG_LEVEL: 'silent',
      }),
      healthChecks: [],
      verifier: tokens,
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
    await appPool?.end();
    await redisBox?.stop();
    await pgRoles?.postgres.stop();
  });

  const post = async (url: string, payload?: object, headers: Record<string, string> = {}) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      ...(payload === undefined ? {} : { payload }),
    });
    await afterRespond;
    return response;
  };

  it('hides A5/B5 in production even when the flag is set', async () => {
    for (const flag of [undefined, 'true'] as const) {
      const hidden = await buildApp({
        config: productionApiConfig(flag === undefined ? {} : { DEMO_LOGIN_ENABLED: flag }),
        healthChecks: [],
      });
      try {
        const unknown = await hidden.inject({ method: 'POST', url: '/no-such-demo-route' });
        const a5 = await hidden.inject({ method: 'POST', url: '/v1/app/auth/demo' });
        const b5 = await hidden.inject({ method: 'POST', url: '/v1/admin/auth/demo' });
        expect(a5.statusCode).toBe(404);
        expect(a5.body).toBe(unknown.body);
        expect(b5.body).toBe(unknown.body);
        expect(a5.json()).toEqual(NOT_FOUND);
        expect(hidden.printRoutes()).not.toMatch(/demo \(POST\)/);
      } finally {
        await hidden.close();
      }
    }
  });

  it('does not register demo routes for TRUE, 1, or an omitted flag', async () => {
    for (const flag of ['TRUE', '1', undefined] as const) {
      const hidden = await buildApp({
        config: testConfig({
          TRUST_PROXY_HOPS: '1',
          ...(flag === undefined ? {} : { DEMO_LOGIN_ENABLED: flag }),
        }),
        healthChecks: [],
      });
      try {
        expect(hidden.hasRoute({ method: 'POST', url: '/v1/app/auth/demo' })).toBe(false);
        expect(hidden.hasRoute({ method: 'POST', url: '/v1/admin/auth/demo' })).toBe(false);
        const a5 = await hidden.inject({ method: 'POST', url: '/v1/app/auth/demo' });
        expect(a5.statusCode).toBe(404);
      } finally {
        await hidden.close();
      }
    }
  });

  it('issues one demo shopkeeper session and audit, and rejects a body', async () => {
    const before = await sessionCount(ownerPool, DEMO_SHOPKEEPER_ID);
    const sms = fake.outbox.length;
    const bad = await post('/v1/app/auth/demo', { extra: true });
    expect(bad.statusCode).toBe(422);
    expect(await sessionCount(ownerPool, DEMO_SHOPKEEPER_ID)).toBe(before);
    const ok = await post('/v1/app/auth/demo', {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.isNewAccount).toBe(false);
    expect(ok.json().user.phone).toBe(DEMO_SHOPKEEPER_PHONE);
    expect(ok.json().tokenType).toBe('Bearer');
    expect(claims(ok.json().accessToken).iss).toBe(DEMO_ISS);
    expect(claims(ok.json().accessToken).aud).toBe(DEMO_AUD);
    expect(await sessionCount(ownerPool, DEMO_SHOPKEEPER_ID)).toBe(before + 1);
    const audit = await ownerPool.query<{ data: { phoneMasked: string; demo: boolean } }>(
      `SELECT data FROM platform.audit_log
        WHERE actor_id = $1 AND action = 'login_success' AND data->>'demo' = 'true'`,
      [DEMO_SHOPKEEPER_ID],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.data.phoneMasked).not.toBe(DEMO_SHOPKEEPER_PHONE);
    expect(JSON.stringify(audit.rows)).not.toContain(ok.json().refreshToken as string);
    expect(fake.outbox.length).toBe(sms);
    const events = await ownerPool.query(
      `SELECT count(*)::text AS c FROM platform.outbox_events WHERE payload->>'accountId' = $1`,
      [DEMO_SHOPKEEPER_ID],
    );
    expect(events.rows[0]?.c).toBe('0');
  });

  it('mints only the seeded distributor admin and ignores the scope header', async () => {
    const sms = fake.outbox.length;
    const ok = await post('/v1/admin/auth/demo', {}, { 'x-scope-distributor': REAL_DIST });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().staff.role).toBe('distributor_admin');
    expect(ok.json().staff.distributorId).toBe(DEMO_DISTRIBUTOR_ID);
    expect(claims(ok.json().accessToken).did).toBe(DEMO_DISTRIBUTOR_ID);
    expect(fake.outbox.length).toBe(sms);
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.distributor_id', $1, true)`, [
        DEMO_DISTRIBUTOR_ID,
      ]);
      const real = await client.query(`SELECT id FROM tenancy.distributors WHERE id = $1`, [
        REAL_DIST,
      ]);
      const demo = await client.query(`SELECT id FROM tenancy.distributors WHERE id = $1`, [
        DEMO_DISTRIBUTOR_ID,
      ]);
      expect(real.rowCount).toBe(0);
      expect(demo.rowCount).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const at = ok.json().accessToken as string;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/admin/still-there',
          headers: { authorization: `Bearer ${at}` },
        })
      ).statusCode,
    ).toBe(404);
    await ownerPool.query(
      `UPDATE identity.sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE sid = $1`,
      [claims(at).sid],
    );
    const fresh = await post('/v1/admin/auth/logout', {}, { authorization: `Bearer ${at}` });
    expect(fresh.statusCode).toBe(401);
  });

  it('refreshes and logs out a demo shopkeeper, and rejects the RT when the flag is off', async () => {
    const issued = await post('/v1/app/auth/demo', {});
    expect(issued.statusCode).toBe(200);
    const refreshToken = issued.json().refreshToken as string;
    const refreshed = await post('/v1/app/auth/refresh', { refreshToken });
    expect(refreshed.statusCode).toBe(200);
    expect(claims(refreshed.json().accessToken).aud).toBe(DEMO_AUD);
    const successor = refreshed.json().refreshToken as string;
    const logged = await post('/v1/app/auth/logout', { refreshToken: successor });
    expect(logged.statusCode).toBe(200);
    expect((await post('/v1/app/auth/refresh', { refreshToken: successor })).statusCode).toBe(401);
    const again = await post('/v1/app/auth/demo', {});
    const held = again.json().refreshToken as string;
    const before = await tokenCount(ownerPool, DEMO_SHOPKEEPER_ID);
    const off = await buildApp({
      config: testConfig({ TRUST_PROXY_HOPS: '1' }),
      healthChecks: [],
      verifier: tokens,
      sessionAuthority: otp.authority,
      assertIssuance: () => assertRedisForAuthIssuance(redis),
      otpAuth: { ...otp, demoLogin: false },
    });
    try {
      const denied = await off.inject({
        method: 'POST',
        url: '/v1/app/auth/refresh',
        headers: { 'content-type': 'application/json' },
        payload: { refreshToken: held },
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.json().error.code).toBe('UNAUTHENTICATED');
      expect(await tokenCount(ownerPool, DEMO_SHOPKEEPER_ID)).toBe(before);
    } finally {
      await off.close();
    }
  });

  it('rejects cross kid and audience pairs, a prod-only verifier, and a shopkeeper demo AT on admin', async () => {
    const issued = await post('/v1/app/auth/demo', {});
    const at = issued.json().accessToken as string;
    const admin = await app.inject({
      method: 'GET',
      url: '/v1/admin/still-there',
      headers: { authorization: `Bearer ${at}` },
    });
    expect(admin.statusCode).toBe(401);
    const home = await app.inject({
      method: 'GET',
      url: '/v1/app/still-there',
      headers: { authorization: `Bearer ${at}` },
    });
    expect(home.statusCode).toBe(404);
    const pairs = [
      { key: demoKey, kid: 'k-demo', iss: 'vproject', aud: DEMO_AUD },
      { key: demoKey, kid: 'k-demo', iss: DEMO_ISS, aud: 'app' },
      { key: prodKey, kid: 'k-prod', iss: DEMO_ISS, aud: 'app' },
      { key: prodKey, kid: 'k-prod', iss: 'vproject', aud: DEMO_AUD },
    ];
    for (const pair of pairs) {
      const token = await signRaw(pair.key.privateKey, pair);
      const response = await app.inject({
        method: 'GET',
        url: '/v1/app/still-there',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
    }
    const prodOnly = new DemoAwareTokens(
      new EddsaAccessTokenService({ iss: 'vproject', activeKid: 'k-prod', keys: [prodKey] }),
      null,
      null,
    );
    const prodApp = await buildApp({
      config: testConfig({ TRUST_PROXY_HOPS: '1', DEMO_LOGIN_ENABLED: 'true' }),
      healthChecks: [],
      verifier: prodOnly,
      sessionAuthority: otp.authority,
      assertIssuance: () => assertRedisForAuthIssuance(redis),
      otpAuth: otp,
    });
    try {
      const response = await prodApp.inject({
        method: 'GET',
        url: '/v1/app/still-there',
        headers: { authorization: `Bearer ${at}` },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await prodApp.close();
    }
  });

  it('hides demo accounts from A1/A2/B1/B2/C1', async () => {
    const sms = fake.outbox.length;
    const a1 = await post('/v1/app/auth/otp/send', { phone: DEMO_SHOPKEEPER_PHONE });
    const b1 = await post('/v1/admin/auth/otp/send', { phone: DEMO_STAFF_PHONE });
    expect(a1.statusCode).toBe(200);
    expect(b1.statusCode).toBe(200);
    expect(a1.json()).toEqual(b1.json());
    expect(fake.outbox.length).toBe(sms);
    const a2 = await post('/v1/app/auth/otp/verify', {
      phone: DEMO_SHOPKEEPER_PHONE,
      code: '000000',
    });
    const unknown = await post('/v1/app/auth/otp/verify', {
      phone: '+989111111111',
      code: '000000',
    });
    expect(a2.statusCode).toBe(unknown.statusCode);
    expect(a2.json()).toEqual(unknown.json());
    const b2 = await post('/v1/admin/auth/otp/verify', { phone: DEMO_STAFF_PHONE, code: '000000' });
    const unknownStaff = await post('/v1/admin/auth/otp/verify', {
      phone: '+989111111112',
      code: '000000',
    });
    expect(b2.statusCode).toBe(unknownStaff.statusCode);
    expect(b2.json()).toEqual(unknownStaff.json());
    const demoDriver = await post('/v1/driver/auth/login', {
      username: 'demodriver',
      password: 'nope',
    });
    const missing = await post('/v1/driver/auth/login', { username: 'nobody', password: 'nope' });
    expect(demoDriver.statusCode).toBe(401);
    expect(demoDriver.json()).toEqual(missing.json());
  });

  it('fails closed with no new session when the seed is missing, Postgres fails, or Redis fails', async () => {
    await ownerPool.query(
      `DELETE FROM identity.refresh_tokens WHERE sid IN
         (SELECT sid FROM identity.sessions WHERE account_id = $1)`,
      [DEMO_SHOPKEEPER_ID],
    );
    await ownerPool.query(
      `DELETE FROM identity.pending_session_denies WHERE sid IN
         (SELECT sid FROM identity.sessions WHERE account_id = $1)`,
      [DEMO_SHOPKEEPER_ID],
    );
    await ownerPool.query(`DELETE FROM identity.sessions WHERE account_id = $1`, [
      DEMO_SHOPKEEPER_ID,
    ]);
    await ownerPool.query(`DELETE FROM customers.shopkeepers WHERE account_id = $1`, [
      DEMO_SHOPKEEPER_ID,
    ]);
    await ownerPool.query(`DELETE FROM identity.accounts WHERE id = $1`, [DEMO_SHOPKEEPER_ID]);
    try {
      const missing = await post('/v1/app/auth/demo', {});
      expect(missing.statusCode).toBe(503);
      expect(missing.headers['retry-after']).toBe('2');
      expect(await sessionCount(ownerPool, DEMO_SHOPKEEPER_ID)).toBe(0);
    } finally {
      await seedDemoLogin(ownerPool);
    }
    expect(await sessionCount(ownerPool, DEMO_SHOPKEEPER_ID)).toBe(0);
    const original = identityPool.query.bind(identityPool);
    identityPool.query = ((text: string, values?: unknown[]) => {
      if (text.includes('lookup_demo_account')) {
        return Promise.reject(new Error('Connection terminated'));
      }
      return original(text, values);
    }) as typeof identityPool.query;
    try {
      const down = await post('/v1/app/auth/demo', {});
      expect(down.statusCode).toBe(503);
      expect(down.headers['retry-after']).toBe('2');
      expect(await sessionCount(ownerPool, DEMO_SHOPKEEPER_ID)).toBe(0);
    } finally {
      identityPool.query = original;
    }
    const staffBefore = await sessionCount(ownerPool, DEMO_STAFF_ID);
    const ping = redis.ping.bind(redis);
    redis.ping = (() => Promise.reject(new Error('redis down'))) as typeof redis.ping;
    try {
      const down = await post('/v1/admin/auth/demo', {});
      expect(down.statusCode).toBe(503);
      expect(down.headers['retry-after']).toBe('5');
      expect(await sessionCount(ownerPool, DEMO_STAFF_ID)).toBe(staffBefore);
    } finally {
      redis.ping = ping;
    }
  });
});

function claims(token: string): { iss?: string; aud?: string; did?: string; sid: string } {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
    iss?: string;
    aud?: string;
    did?: string;
    sid: string;
  };
}

async function sessionCount(pool: pg.Pool, accountId: string): Promise<number> {
  const row = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM identity.sessions WHERE account_id = $1`,
    [accountId],
  );
  return Number(row.rows[0]?.c ?? 0);
}

async function tokenCount(pool: pg.Pool, accountId: string): Promise<number> {
  const row = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM identity.refresh_tokens t
       JOIN identity.sessions s ON s.sid = t.sid WHERE s.account_id = $1`,
    [accountId],
  );
  return Number(row.rows[0]?.c ?? 0);
}

function signRaw(
  key: Ed25519SigningKey['privateKey'],
  input: { kid: string; iss: string; aud: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: 'shopkeeper', sid: randomUUID(), sv: 0 })
    .setProtectedHeader({ alg: JWT_ALG, kid: input.kid, typ: JWT_TYP })
    .setSubject(randomUUID())
    .setIssuer(input.iss)
    .setAudience(input.aud)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 900)
    .sign(key);
}
