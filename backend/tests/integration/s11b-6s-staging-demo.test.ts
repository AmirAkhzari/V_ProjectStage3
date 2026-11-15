import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Redis } from 'ioredis';
import pg from 'pg';
import { pino } from 'pino';
import { buildApp, type App } from '../../src/app.js';
import { seedDemoLogin } from '../../scripts/seed-demo.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import {
  DEMO_DA_PERMISSIONS,
  DEMO_STAFF_ID,
} from '../../src/modules/identity/domain/demoAccounts.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import { PgSessionStore } from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { FakeSmsProvider } from '../../src/modules/notification/infra/sms/fakeSmsProvider.js';
import { DEMO_AUD, DEMO_ISS } from '../../src/platform/auth/demoLogin.js';
import { DemoAwareTokens } from '../../src/platform/auth/demoTokens.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';
import { pinoOptions } from '../../src/platform/logger.js';
import { createRedis } from '../../src/platform/redis.js';
import { productionApiConfig, testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
const WRITES = ['/v1/admin/orders', '/v1/admin/stock', '/v1/admin/staff'] as const;

describe('V11-DM-05 staging demo login', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let app: App;

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool({ connectionString: pgRoles.identityUrl });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    attachPgTeardownGuard(identityPool);
    attachPgTeardownGuard(ownerPool);
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
    const prodKey = await generateEd25519Key('k-prod');
    const demoKey = await generateEd25519Key('k-demo');
    const tokens = new DemoAwareTokens(
      new EddsaAccessTokenService({ iss: 'vproject', activeKid: 'k-prod', keys: [prodKey] }),
      new EddsaAccessTokenService({
        iss: DEMO_ISS,
        activeKid: 'k-demo',
        keys: [demoKey],
        audience: DEMO_AUD,
      }),
      'k-demo',
    );
    const authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    const log = pino(pinoOptions({ LOG_LEVEL: 'silent' }));
    const otp: OtpAuthRuntime = {
      identityPool,
      redis,
      jwt: tokens,
      authority,
      store: new PgRefreshTokenStore(identityPool, {
        onSidsRevoked: (sids) => authority.deny(sids),
        log,
      }),
      sms: new FakeSmsProvider({ capture: true }),
      log,
      pepper: TEST_OTP_HMAC_KEY,
      budget: { hour: 0, day: 0, skipBudget: true },
    };
    await seedDemoLogin(ownerPool);
    app = await buildApp({
      config: testConfig({
        DEMO_LOGIN_ENABLED: 'true',
        TRUST_PROXY_HOPS: '1',
        RATE_DEMO_PER_IP_HOUR: '1',
        RATE_DEMO_GLOBAL_DAY: '2',
      }),
      healthChecks: [],
      verifier: tokens,
      sessionAuthority: authority,
      otpAuth: otp,
      demoWriteProbe: true,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit().catch(() => redis?.disconnect());
    await identityPool?.end();
    await ownerPool?.end();
    await redisBox?.stop();
    await pgRoles?.postgres.stop();
  });

  it('keeps production A5/B5 byte-identical to an unknown route and registers them on staging', async () => {
    const prod = await buildApp({
      config: { ...productionApiConfig(), DEMO_LOGIN_ENABLED: 'true' },
      healthChecks: [],
    });
    const staging = await buildApp({
      config: {
        ...productionApiConfig(),
        DEPLOY_ENV: 'staging',
        DEMO_LOGIN_ENABLED: 'true',
        RATE_DEMO_PER_IP_HOUR: 10,
        RATE_DEMO_GLOBAL_DAY: 200,
      },
      healthChecks: [],
    });
    try {
      const headers = { 'x-request-id': 'staging-demo-404' };
      const unknown = await prod.inject({ method: 'POST', url: '/no-such-demo-route', headers });
      const a5 = await prod.inject({ method: 'POST', url: '/v1/app/auth/demo', headers });
      const b5 = await prod.inject({ method: 'POST', url: '/v1/admin/auth/demo', headers });
      expect(a5.statusCode).toBe(unknown.statusCode);
      expect(b5.statusCode).toBe(unknown.statusCode);
      expect(a5.headers).toEqual(unknown.headers);
      expect(b5.headers).toEqual(unknown.headers);
      expect(a5.body).toBe(unknown.body);
      expect(b5.body).toBe(unknown.body);
      expect(a5.json()).toEqual(NOT_FOUND);
      expect(staging.hasRoute({ method: 'POST', url: '/v1/app/auth/demo' })).toBe(true);
      expect(staging.hasRoute({ method: 'POST', url: '/v1/admin/auth/demo' })).toBe(true);
    } finally {
      await prod.close();
      await staging.close();
    }
  });

  it('upserts the demo admin to the allowlist and will not issue a wider set', async () => {
    await ownerPool.query(
      `UPDATE identity.staff_memberships
          SET permissions = ARRAY['dashboard.view','orders.update','stock.manage','staff.manage']
        WHERE account_id = $1`,
      [DEMO_STAFF_ID],
    );
    await seedDemoLogin(ownerPool);
    const seeded = await ownerPool.query<{ permissions: string[] }>(
      `SELECT permissions FROM identity.staff_memberships WHERE account_id = $1`,
      [DEMO_STAFF_ID],
    );
    expect(seeded.rows[0]?.permissions).toEqual([...DEMO_DA_PERMISSIONS]);
    await ownerPool.query(
      `UPDATE identity.staff_memberships
          SET permissions = ARRAY['dashboard.view','orders.update','stock.manage','staff.manage']
        WHERE account_id = $1`,
      [DEMO_STAFF_ID],
    );
    const login = await post('/v1/admin/auth/demo', {}, { 'x-forwarded-for': '203.0.113.10' });
    expect(login.statusCode).toBe(200);
    expect(login.json().staff.permissions).toEqual(['dashboard.view']);
    const refreshed = await post('/v1/admin/auth/refresh', {
      refreshToken: login.json().refreshToken,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().staff.permissions).toEqual(['dashboard.view']);
    const token = login.json().accessToken as string;
    for (const path of WRITES) {
      const denied = await app.inject({
        method: 'POST',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('shares one A5/B5 limit and adds no rows when limited or when Redis is down', async () => {
    const stale = await redis.keys('demo:lim:*');
    if (stale.length > 0) await redis.del(...stale);
    const first = await post('/v1/admin/auth/demo', {}, { 'x-forwarded-for': '203.0.113.21' });
    expect(first.statusCode).toBe(200);
    const before = await counts();
    const again = await post('/v1/app/auth/demo', {}, { 'x-forwarded-for': '203.0.113.21' });
    expect(again.statusCode).toBe(429);
    expect(again.headers['retry-after']).toBeTruthy();
    expect(again.json().error.code).toBe('RATE_LIMITED');
    expect(await counts()).toEqual(before);
    const second = await post('/v1/app/auth/demo', {}, { 'x-forwarded-for': '203.0.113.22' });
    expect(second.statusCode).toBe(200);
    const afterSecond = await counts();
    const third = await post('/v1/admin/auth/demo', {}, { 'x-forwarded-for': '203.0.113.23' });
    expect(third.statusCode).toBe(429);
    expect(await counts()).toEqual(afterSecond);
    const dead = await buildApp({
      config: testConfig({
        DEMO_LOGIN_ENABLED: 'true',
        RATE_DEMO_PER_IP_HOUR: '10',
        RATE_DEMO_GLOBAL_DAY: '200',
      }),
      healthChecks: [],
      otpAuth: {
        redis: { eval: () => Promise.reject(new Error('down')) } as unknown as Redis,
      } as OtpAuthRuntime,
    });
    try {
      const down = await dead.inject({
        method: 'POST',
        url: '/v1/app/auth/demo',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });
      expect(down.statusCode).toBe(503);
      expect(down.headers['retry-after']).toBe('2');
      expect(down.json().error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await dead.close();
    }
    expect(await counts()).toEqual(afterSecond);
  });

  async function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      payload,
    });
  }

  async function counts() {
    const row = await ownerPool.query<{ sessions: string; tokens: string; audits: string }>(
      `SELECT
         (SELECT count(*) FROM identity.sessions)::text AS sessions,
         (SELECT count(*) FROM identity.refresh_tokens)::text AS tokens,
         (SELECT count(*) FROM platform.audit_log WHERE action = 'login_success')::text AS audits`,
    );
    return row.rows[0];
  }
});
