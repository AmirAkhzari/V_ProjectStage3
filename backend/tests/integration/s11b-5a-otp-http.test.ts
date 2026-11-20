import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { pino } from 'pino';
import { buildApp, type App } from '../../src/app.js';
import {
  lookupActiveStaffOtp,
  type OtpAuthRuntime,
} from '../../src/modules/identity/application/otpAuth.js';
import { FakeSmsProvider } from '../../src/modules/notification/infra/sms/fakeSmsProvider.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import {
  PgSessionStore,
  silentDrainLog,
} from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { pinoOptions } from '../../src/platform/logger.js';
import { TEST_OTP_HMAC_KEY } from '../../src/platform/config.js';
import { otpPhoneHash } from '../../src/modules/identity/infra/otp/redisOtpStore.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  startRedis,
  type StartedPostgresRoles,
  type StartedTestRedis,
} from '../helpers/containers.js';

const DIST = '11111111-1111-4111-8111-111111111111';
let ipSeq = 1;
function nextIp(): string {
  const n = ipSeq++;
  return `198.51.${(n >> 8) & 0xff}.${n & 0xff}`;
}

describe('S11b-5a OTP HTTP A1/A2/B1/B2', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedTestRedis;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let jwt: EddsaAccessTokenService;
  let fake: FakeSmsProvider;
  let runtime: OtpAuthRuntime;
  let app: App;
  let afterRespond: Promise<void> = Promise.resolve();
  const logs: string[] = [];

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await startRedis();
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
    runtime = {
      identityPool,
      redis,
      jwt,
      authority,
      store: new PgRefreshTokenStore(identityPool, {
        onSidsRevoked: (sids) => authority.deny(sids),
        log: silentDrainLog,
      }),
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
      verifier: jwt,
      sessionAuthority: authority,
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
    expect(await redis.exists(`otp:staff:${otpPhoneHash(unknown, TEST_OTP_HMAC_KEY)}`)).toBe(1);
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
    expect(await redis.exists(`otp:staff:${otpPhoneHash(inactive, TEST_OTP_HMAC_KEY)}`)).toBe(1);
    expect(await redis.exists(`otp:staff:${otpPhoneHash(unknown, TEST_OTP_HMAC_KEY)}`)).toBe(1);
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

  it('A2 first-login creates shopkeeper in one txn; second login is not new', async () => {
    const phone = '+989121100003';
    const ip = nextIp();
    const send = await post('/v1/app/auth/otp/send', { phone }, ip);
    expect(send.statusCode).toBe(200);
    const code = fake.outbox.at(-1)?.code;
    expect(code).toMatch(/^[0-9]{6}$/);
    const first = await post('/v1/app/auth/otp/verify', { phone, code }, ip);
    expect(first.statusCode).toBe(200);
    const body = first.json() as {
      user: { isNewAccount: boolean; id: string };
      accessToken: string;
    };
    expect(body.user.isNewAccount).toBe(true);
    const claims = await jwt.verify(body.accessToken, 'shopkeeper');
    expect(claims.typ).toBe('shopkeeper');
    expect(claims.sub).toBe(body.user.id);
    await redis.del(`otp:lim:p60:${otpPhoneHash(phone, TEST_OTP_HMAC_KEY)}`);
    const send2 = await post('/v1/app/auth/otp/send', { phone });
    expect(send2.statusCode).toBe(200);
    const code2 = fake.outbox.at(-1)?.code;
    const second = await post('/v1/app/auth/otp/verify', { phone, code: code2 });
    expect(second.statusCode).toBe(200);
    expect(second.json().user.isNewAccount).toBe(false);
  });

  it('B2 unknown equals wrong code (OTP_INVALID); active staff issues typ=staff', async () => {
    const phone = '+989121100004';
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, 'super_admin', NULL, '{}')`,
      [accountId],
    );
    await post('/v1/admin/auth/otp/send', { phone });
    const code = fake.outbox.at(-1)?.code;
    const wrong = await post('/v1/admin/auth/otp/verify', { phone, code: '000000' });
    const unknown = await post('/v1/admin/auth/otp/verify', {
      phone: '+989121100099',
      code: '123456',
    });
    expect(wrong.statusCode).toBe(422);
    expect(unknown.statusCode).toBe(422);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toMatchObject({ error: { code: 'OTP_INVALID' } });
    const ok = await post('/v1/admin/auth/otp/verify', { phone, code });
    expect(ok.statusCode).toBe(200);
    const claims = await jwt.verify(ok.json().accessToken as string, 'staff');
    expect(claims.typ).toBe('staff');
    expect(ok.json().staff.role).toBe('super_admin');
    expect(ok.json().staff.distributorId).toBeNull();
    const audits = await ownerPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM platform.audit_log
        WHERE action = 'login_success' AND actor_type = 'staff' AND entity_id = $1`,
      [claims.sid],
    );
    expect(audits.rows[0]?.n).toBe('1');
  });

  it('N18-6: distributor_admin B2 JWT did + stored permissions; lookup requires one membership', async () => {
    const phone = '+989121100031';
    const accountId = randomUUID();
    const permissions = ['orders.view', 'stock.view'];
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, 'distributor_admin', $2, $3)`,
      [accountId, DIST, permissions],
    );
    const found = await lookupActiveStaffOtp(identityPool, phone);
    expect(found).toMatchObject({
      account_id: accountId,
      role: 'distributor_admin',
      distributor_id: DIST,
      status: 'active',
      permissions,
    });
    expect(
      (
        await identityPool.query(`SELECT count(*)::int AS n FROM identity.lookup_staff_otp($1)`, [
          phone,
        ])
      ).rows[0]?.n,
    ).toBe(1);
    await post('/v1/admin/auth/otp/send', { phone });
    const code = fake.outbox.at(-1)?.code;
    const ok = await post('/v1/admin/auth/otp/verify', { phone, code });
    expect(ok.statusCode, ok.body).toBe(200);
    const body = ok.json() as {
      accessToken: string;
      staff: { role: string; distributorId: string | null; permissions: string[] };
    };
    expect(body.staff.role).toBe('distributor_admin');
    expect(body.staff.distributorId).toBe(DIST);
    expect(body.staff.permissions).toEqual(permissions);
    const claims = await jwt.verify(body.accessToken, 'staff');
    expect(claims.did).toBe(DIST);
  });

  it('N18-4: ISSUE_ABORTED is 422 OTP_INVALID; other issue errors are 503', async () => {
    const phone = '+989121100032';
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, 'super_admin', NULL, '{}')`,
      [accountId],
    );
    const orig = runtime.store.issue.bind(runtime.store);
    try {
      await post('/v1/admin/auth/otp/send', { phone });
      const codeAborted = fake.outbox.at(-1)?.code;
      runtime.store.issue = async () => {
        throw Object.assign(new Error('inactive'), { code: 'ISSUE_ABORTED' });
      };
      const aborted = await post('/v1/admin/auth/otp/verify', { phone, code: codeAborted });
      expect(aborted.statusCode).toBe(422);
      expect(aborted.json()).toMatchObject({ error: { code: 'OTP_INVALID' } });
      await redis.del(`otp:lim:p60:${otpPhoneHash(phone, TEST_OTP_HMAC_KEY)}`);
      await post('/v1/admin/auth/otp/send', { phone });
      const codeBoom = fake.outbox.at(-1)?.code;
      runtime.store.issue = async () => {
        throw new Error('disk full');
      };
      const boom = await post('/v1/admin/auth/otp/verify', { phone, code: codeBoom });
      expect(boom.statusCode).toBe(503);
      expect(boom.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      runtime.store.issue = orig;
    }
  });

  it('LIM-OTP-T-01 HTTP: second send in 60s is 429; Redis down before respond is 503', async () => {
    const phone = '+989121100005';
    const ip = nextIp();
    const first = await post('/v1/app/auth/otp/send', { phone }, ip);
    expect(first.statusCode).toBe(200);
    const second = await post('/v1/app/auth/otp/send', { phone }, ip);
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeTruthy();
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
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

  it('AUTH-LG-02-PR + G7: B2 unknown vs wrong p95 overlap; logs/audit have no code or full phone', async () => {
    const p95 = (samples: number[]): number => {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0;
    };
    const unknownTimes: number[] = [];
    const wrongTimes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const staffPhone = `+989124${String(400000 + i)}`;
      const accountId = randomUUID();
      await ownerPool.query(
        `INSERT INTO identity.accounts
           (id, typ, phone, status, session_version, must_change_password, created_at)
         VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
        [accountId, staffPhone],
      );
      await ownerPool.query(
        `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
         VALUES ($1, 'super_admin', NULL, '{}')`,
        [accountId],
      );
      await post('/v1/admin/auth/otp/send', { phone: staffPhone });
      const unknownStart = performance.now();
      const unknown = await post('/v1/admin/auth/otp/verify', {
        phone: `+989123${String(300000 + i)}`,
        code: '000000',
      });
      unknownTimes.push(performance.now() - unknownStart);
      expect(unknown.statusCode).toBe(422);
      const wrongStart = performance.now();
      const wrong = await post('/v1/admin/auth/otp/verify', {
        phone: staffPhone,
        code: '000000',
      });
      wrongTimes.push(performance.now() - wrongStart);
      expect(wrong.statusCode).toBe(422);
      expect(unknown.json()).toEqual(wrong.json());
    }
    const unknownP95 = p95(unknownTimes);
    const wrongP95 = p95(wrongTimes);
    expect(unknownP95).toBeGreaterThan(0);
    expect(wrongP95).toBeGreaterThan(0);
    expect(Math.max(unknownP95, wrongP95) / Math.min(unknownP95, wrongP95)).toBeLessThan(4);
    const blob = logs.join('\n');
    expect(blob).not.toMatch(/\+9891[0-9]{9}/);
    expect(blob).not.toMatch(/"code":"[0-9]{6}"/);
    const audits = await ownerPool.query<{ data: unknown }>(
      `SELECT data FROM platform.audit_log WHERE action = 'login_success'`,
    );
    expect(JSON.stringify(audits.rows)).not.toMatch(/[0-9]{6}/);
    expect(JSON.stringify(audits.rows)).not.toMatch(/\+9891[0-9]{9}/);
  }, 60_000);

  it('P16-4: PG history insert fail drops the Redis challenge', async () => {
    const phone = '+989121100041';
    const real = runtime.identityPool;
    runtime.identityPool = {
      query: (text: unknown, values?: unknown) => {
        if (typeof text === 'string' && text.includes('INSERT INTO identity.otp_challenges')) {
          return Promise.reject(new Error('otp history down'));
        }
        return real.query(text as never, values as never);
      },
    } as typeof real;
    try {
      const response = await post('/v1/app/auth/otp/send', { phone });
      expect(response.statusCode).toBe(503);
      expect(await redis.exists(`otp:app:${otpPhoneHash(phone, TEST_OTP_HMAC_KEY)}`)).toBe(0);
    } finally {
      runtime.identityPool = real;
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

  it('P18-1: A2 rechecks active status under the account lock', async () => {
    const phone = '+989121100081';
    const ip = nextIp();
    await post('/v1/app/auth/otp/send', { phone }, ip);
    const firstCode = fake.outbox.at(-1)?.code;
    const first = await post('/v1/app/auth/otp/verify', { phone, code: firstCode }, ip);
    expect(first.statusCode).toBe(200);
    const accountId = first.json().user.id as string;
    await redis.del(`otp:lim:p60:${otpPhoneHash(phone, TEST_OTP_HMAC_KEY)}`);
    await post('/v1/app/auth/otp/send', { phone });
    const code = fake.outbox.at(-1)?.code;
    const holder = await ownerPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [accountId]);
      const pending = post('/v1/app/auth/otp/verify', { phone, code });
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      await holder.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [
        accountId,
      ]);
      await holder.query('COMMIT');
      const response = await pending;
      expect([422, 503]).toContain(response.statusCode);
      if (response.statusCode === 422) {
        expect(response.json()).toMatchObject({ error: { code: 'OTP_INVALID' } });
      }
    } finally {
      holder.release();
    }
    const sessions = await ownerPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM identity.sessions WHERE account_id = $1`,
      [accountId],
    );
    expect(sessions.rows[0]?.n).toBe('1');
  });

  it('P18-2: OTP_LOCKED is 429; hourly verify cap is RATE_LIMITED', async () => {
    const lockedPhone = '+989121100082';
    await post('/v1/app/auth/otp/send', { phone: lockedPhone });
    for (let i = 0; i < 4; i += 1) {
      const wrong = await post('/v1/app/auth/otp/verify', { phone: lockedPhone, code: '000000' });
      expect(wrong.statusCode).toBe(422);
      expect(wrong.json()).toMatchObject({ error: { code: 'OTP_INVALID' } });
    }
    const locked = await post('/v1/app/auth/otp/verify', { phone: lockedPhone, code: '000000' });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeTruthy();
    expect(locked.json()).toMatchObject({ error: { code: 'OTP_LOCKED' } });

    const hourlyPhone = '+989121100083';
    for (let i = 0; i < 10; i += 1) {
      const miss = await post('/v1/app/auth/otp/verify', { phone: hourlyPhone, code: '000000' });
      expect(miss.statusCode).toBe(422);
    }
    const limited = await post('/v1/app/auth/otp/verify', { phone: hourlyPhone, code: '000000' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect(limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('P18-5: inactive distributor is not staff for B1/B2', async () => {
    const distId = '22222222-2222-4222-8222-222222222222';
    const phone = '+989121100084';
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'Locked Dist', 'inactive', now())`,
      [distId],
    );
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, 'distributor_admin', $2, '{}')`,
      [accountId, distId],
    );
    expect(await lookupActiveStaffOtp(identityPool, phone)).toBeUndefined();
    fake.outbox.length = 0;
    const send = await post('/v1/admin/auth/otp/send', { phone });
    expect(send.statusCode).toBe(200);
    expect(fake.outbox).toHaveLength(0);
    const verify = await post('/v1/admin/auth/otp/verify', { phone, code: '123456' });
    expect(verify.statusCode).toBe(422);
    expect(verify.json()).toMatchObject({ error: { code: 'OTP_INVALID' } });
  });

  it('P18-6: membership removed before issue does not create a staff session', async () => {
    const phone = '+989121100085';
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, 'super_admin', NULL, '{}')`,
      [accountId],
    );
    await post('/v1/admin/auth/otp/send', { phone });
    const code = fake.outbox.at(-1)?.code;
    const holder = await ownerPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [accountId]);
      const pending = post('/v1/admin/auth/otp/verify', { phone, code });
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      await holder.query(`DELETE FROM identity.staff_memberships WHERE account_id = $1`, [
        accountId,
      ]);
      await holder.query('COMMIT');
      const response = await pending;
      expect([422, 503]).toContain(response.statusCode);
    } finally {
      holder.release();
    }
    const sessions = await ownerPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM identity.sessions WHERE account_id = $1`,
      [accountId],
    );
    expect(sessions.rows[0]?.n).toBe('0');
  });

  it('P18-9: five wrong B2 guesses match for staff vs non-staff', async () => {
    const staffPhone = '+989121100091';
    const unknown = '+989121100092';
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [randomUUID(), staffPhone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       SELECT id, 'super_admin', NULL, '{}'::text[] FROM identity.accounts WHERE phone = $1`,
      [staffPhone],
    );
    expect((await post('/v1/admin/auth/otp/send', { phone: staffPhone })).statusCode).toBe(200);
    expect((await post('/v1/admin/auth/otp/send', { phone: unknown })).statusCode).toBe(200);
    const guess = async (phone: string) => {
      const response = await post('/v1/admin/auth/otp/verify', { phone, code: '999999' });
      return { status: response.statusCode, body: response.body };
    };
    const staffSeq: { status: number; body: string }[] = [];
    const unknownSeq: { status: number; body: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      staffSeq.push(await guess(staffPhone));
      unknownSeq.push(await guess(unknown));
    }
    expect(staffSeq).toEqual(unknownSeq);
    expect(staffSeq.map((row) => row.status)).toEqual([422, 422, 422, 422, 429]);
    expect(staffSeq.slice(0, 4).map((row) => JSON.parse(row.body).error.code)).toEqual([
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
    ]);
    expect(JSON.parse(staffSeq[4]?.body ?? '{}').error.code).toBe('OTP_LOCKED');
  });

  it('N-R3: B2 staff lookup PG error is 503', async () => {
    const phone = '+989121100093';
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [randomUUID(), phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       SELECT id, 'super_admin', NULL, '{}'::text[] FROM identity.accounts WHERE phone = $1`,
      [phone],
    );
    await post('/v1/admin/auth/otp/send', { phone });
    const code = fake.outbox.at(-1)?.code;
    const real = runtime.identityPool;
    runtime.identityPool = {
      query: (text: unknown, values?: unknown) => {
        if (typeof text === 'string' && text.includes('lookup_staff_otp')) {
          return Promise.reject(new Error('staff lookup down'));
        }
        return real.query(text as never, values as never);
      },
    } as typeof real;
    try {
      const response = await post('/v1/admin/auth/otp/verify', { phone, code });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      runtime.identityPool = real;
    }
  });

  it('N-R4: distributor deactivation under lock aborts staff issue', async () => {
    const phone = '+989121100094';
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
      [accountId, phone],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, 'distributor_admin', $2, '{}')`,
      [accountId, DIST],
    );
    await post('/v1/admin/auth/otp/send', { phone });
    const code = fake.outbox.at(-1)?.code;
    const holder = await ownerPool.connect();
    try {
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [
          accountId,
        ]);
        const pending = post('/v1/admin/auth/otp/verify', { phone, code });
        await new Promise((resolve) => {
          setTimeout(resolve, 150);
        });
        await holder.query(`UPDATE tenancy.distributors SET status = 'inactive' WHERE id = $1`, [
          DIST,
        ]);
        await holder.query('COMMIT');
        const response = await pending;
        expect([422, 503]).toContain(response.statusCode);
      } finally {
        holder.release();
      }
      const sessions = await ownerPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM identity.sessions WHERE account_id = $1`,
        [accountId],
      );
      expect(sessions.rows[0]?.n).toBe('0');
    } finally {
      await ownerPool.query(`UPDATE tenancy.distributors SET status = 'active' WHERE id = $1`, [
        DIST,
      ]);
    }
  });
});
