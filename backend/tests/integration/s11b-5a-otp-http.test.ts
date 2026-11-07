import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { pino } from 'pino';
import { buildApp, type App } from '../../src/app.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import { FakeSmsProvider } from '../../src/modules/notification/infra/sms/fakeSmsProvider.js';
import { pinoOptions } from '../../src/platform/logger.js';
import { TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';
import { otpPhoneHash } from '../../src/modules/identity/infra/otp/redisOtpStore.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST = '11111111-1111-1111-1111-111111111111';
let ipSeq = 1;
function nextIp(): string {
  const n = ipSeq++;
  return `198.51.${(n >> 8) & 0xff}.${n & 0xff}`;
}

describe('S11b-5a OTP HTTP A1/B1 send', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let fake: FakeSmsProvider;
  let runtime: OtpAuthRuntime;
  let app: App;
  let afterRespond: Promise<void> = Promise.resolve();
  const logs: string[] = [];

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool({ connectionString: pgRoles.identityUrl });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    attachPgTeardownGuard(identityPool);
    attachPgTeardownGuard(ownerPool);
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
    fake = new FakeSmsProvider({ capture: true });
    const log = pino(pinoOptions({ LOG_LEVEL: 'info' }), {
      write(chunk: string) {
        logs.push(chunk);
      },
    });
    runtime = {
      identityPool,
      redis,
      sms: fake,
      log,
      pepper: TEST_OTP_HMAC_KEY,
      budget: { hour: 0, day: 0, skipBudget: true },
      runAfterRespond: (fn) => {
        afterRespond = Promise.resolve(fn());
      },
    };
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'Dist A', 'active', now())`,
      [DIST],
    );
    app = await buildApp({
      config: testConfig({ TRUST_PROXY_HOPS: '1' }),
      healthChecks: [],
      assertIssuance: async () => {},
      otpAuth: runtime,
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

  beforeEach(async () => {
    const keys = [...(await redis.keys('otp:*')), ...(await redis.keys('login:*'))];
    if (keys.length > 0) await redis.del(...keys);
    fake.outbox.length = 0;
    fake.nextStatus = 'sent';
    logs.length = 0;
  });

  const post = async (url: string, payload: object, ip = nextIp()) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      payload,
    });
    await afterRespond;
    return response;
  };

  it('LIM-OTP-T-08 / AUTH-LG-02: A1/B1 byte-identical for registered/unregistered', async () => {
    const staffPhone = '+989121100011';
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [randomUUID(), staffPhone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       SELECT id, 'distributor_admin', $2, '{}'::text[] FROM identity.accounts WHERE phone = $1`,
      [staffPhone, DIST],
    );
    const a1a = await post('/v1/app/auth/otp/send', { phone: '+989121100001' });
    const a1b = await post('/v1/app/auth/otp/send', { phone: '+989121100002' });
    expect(a1a.statusCode).toBe(200);
    expect(a1a.body).toBe(a1b.body);
    expect(JSON.parse(a1a.body)).toEqual({
      status: 'sent',
      expiresInSeconds: 120,
      resendAfterSeconds: 60,
    });
    fake.outbox.length = 0;
    const b1a = await post('/v1/admin/auth/otp/send', { phone: staffPhone });
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]?.purpose).toBe('staff');
    const unknown = '+989121100012';
    const b1b = await post('/v1/admin/auth/otp/send', { phone: unknown });
    expect(b1a.body).toBe(b1b.body);
    expect(b1a.statusCode).toBe(200);
    expect(fake.outbox).toHaveLength(1);
    expect(fake.outbox[0]?.code).toMatch(/^[0-9]{6}$/);
    expect(await redis.exists(`otp:staff:${otpPhoneHash(unknown, TEST_OTP_HMAC_KEY)}`)).toBe(0);
  });

  it('N18-1: B1 unknown/inactive does not SMS; bytes match active staff', async () => {
    const active = '+989121100021';
    const inactive = '+989121100022';
    const unknown = '+989121100023';
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now()),
              ($3, 'staff', $4, 'inactive', 0, false, now())`,
      [randomUUID(), active, randomUUID(), inactive],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       SELECT id, 'super_admin', NULL, '{}'::text[] FROM identity.accounts
        WHERE phone IN ($1, $2)`,
      [active, inactive],
    );
    const ok = await post('/v1/admin/auth/otp/send', { phone: active });
    expect(ok.statusCode).toBe(200);
    expect(fake.outbox).toHaveLength(1);
    fake.outbox.length = 0;
    const dead = await post('/v1/admin/auth/otp/send', { phone: inactive });
    const miss = await post('/v1/admin/auth/otp/send', { phone: unknown });
    expect(dead.body).toBe(ok.body);
    expect(miss.body).toBe(ok.body);
    expect(fake.outbox).toHaveLength(0);
  });

  it('LIM-OTP-T-02: IP slowdown sleeps before respond', async () => {
    const slept: number[] = [];
    runtime.sleep = async (ms) => {
      slept.push(ms);
    };
    const ip = nextIp();
    for (let i = 0; i < 11; i += 1) {
      const phone = `+98912111${String(1000 + i)}`;
      const response = await post('/v1/app/auth/otp/send', { phone }, ip);
      expect(response.statusCode).toBe(200);
    }
    expect(slept).toEqual([100]);
    delete runtime.sleep;
  });

  it('LIM-OTP-T-01 HTTP: second send in 60s is 429; Redis down before respond is 503', async () => {
    const phone = '+989121100005';
    const ip = nextIp();
    const first = await post('/v1/app/auth/otp/send', { phone }, ip);
    expect(first.statusCode).toBe(200);
    const second = await post('/v1/app/auth/otp/send', { phone }, ip);
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeTruthy();
    expect(second.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    const dead = createRedis('redis://127.0.0.1:1');
    const down = await buildApp({
      config: testConfig({ TRUST_PROXY_HOPS: '1' }),
      healthChecks: [],
      assertIssuance: () => assertRedisForAuthIssuance(dead),
      otpAuth: { ...runtime, redis: dead },
    });
    const failed = await down.inject({
      method: 'POST',
      url: '/v1/app/auth/otp/send',
      headers: { 'x-forwarded-for': nextIp(), 'content-type': 'application/json' },
      payload: { phone: '+989121100006' },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.headers['retry-after']).toBeTruthy();
    await down.close();
  });

  it('G7: send logs have no code or full phone', async () => {
    await post('/v1/app/auth/otp/send', { phone: '+989121100007' });
    const blob = logs.join('\n');
    expect(blob).not.toMatch(/\+9891[0-9]{9}/);
    expect(blob).not.toMatch(/"code":"[0-9]{6}"/);
  });

  it('P16-4: PG history insert fail drops the Redis challenge', async () => {
    const phone = '+989121100041';
    const orig = identityPool.query.bind(identityPool) as typeof identityPool.query;
    identityPool.query = ((...args: unknown[]) => {
      const text = args[0];
      if (typeof text === 'string' && text.includes('INSERT INTO identity.otp_challenges')) {
        return Promise.reject(new Error('otp history down'));
      }
      return orig(...(args as Parameters<typeof orig>));
    }) as typeof identityPool.query;
    try {
      const response = await post('/v1/app/auth/otp/send', { phone });
      expect(response.statusCode).toBe(503);
      expect(await redis.exists(`otp:app:${otpPhoneHash(phone, TEST_OTP_HMAC_KEY)}`)).toBe(0);
    } finally {
      identityPool.query = orig;
    }
  });

  it('P16-6: send outcomes are structured logs', async () => {
    const active = '+989121100051';
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [randomUUID(), active],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       SELECT id, 'super_admin', NULL, '{}'::text[] FROM identity.accounts WHERE phone = $1`,
      [active],
    );
    await post('/v1/admin/auth/otp/send', { phone: active });
    await post('/v1/admin/auth/otp/send', { phone: '+989121100052' });
    const blob = logs.join('\n');
    expect(blob).toMatch(/"otpSendOutcome":"sent"/);
    expect(blob).toMatch(/"otpSendOutcome":"suppressed"/);
  });
});
