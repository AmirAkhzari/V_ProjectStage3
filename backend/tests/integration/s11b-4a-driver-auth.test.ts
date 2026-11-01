import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import argon2 from 'argon2';
import { parse } from 'yaml';
import pg from 'pg';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { buildApp, type App } from '../../src/app.js';
import {
  loginDriver,
  type DriverAuthRuntime,
} from '../../src/modules/identity/application/driverAuth.js';
import {
  TEST_AUDIT_HASH_KEY,
  hashUsernameForAudit,
} from '../../src/modules/identity/domain/loginPolicy.js';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import { hashRefreshToken } from '../../src/modules/identity/infra/crypto/refreshHash.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import {
  PgSessionStore,
  silentDrainLog,
} from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { pino } from 'pino';
import { pinoOptions } from '../../src/platform/logger.js';
import { createRedis } from '../../src/platform/redis.js';
import { productionApiConfig, testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST = '11111111-1111-1111-1111-111111111111';
const PASSWORD = 'correct-horse-12';
const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../../openapi/openapi-v1.2.0.yaml');

function headerNames(response: { headers: Record<string, unknown> }): string[] {
  return Object.keys(response.headers)
    .filter((name) => name !== 'x-request-id' && name !== 'date')
    .sort();
}

function loadAjv() {
  const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
    components: { schemas: Record<string, object> };
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat('date-time', true);
  ajv.addFormat('uuid', true);
  ajv.addFormat('email', true);
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }
  const login = ajv.getSchema('#/components/schemas/DriverAuthSession');
  const refresh = ajv.getSchema('#/components/schemas/DriverRefreshSession');
  if (!login || !refresh) throw new Error('missing schemas');
  return { login, refresh };
}

describe('S11b-4a driver C1/C2', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let jwt: EddsaAccessTokenService;
  let hasher: Argon2idPasswordHasher;
  let passwordHash: string;
  let runtime: DriverAuthRuntime;
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
    const authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [await generateEd25519Key('k1')],
    });
    hasher = new Argon2idPasswordHasher();
    passwordHash = await hasher.hash(PASSWORD);
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'Dist A', 'active', now())`,
      [DIST],
    );
    runtime = {
      identityPool,
      redis,
      jwt,
      authority,
      store: new PgRefreshTokenStore(identityPool, {
        onSidsRevoked: (sids) => authority.deny(sids),
        log: silentDrainLog,
      }),
      hasher,
      log: silentDrainLog,
      auditHashKey: TEST_AUDIT_HASH_KEY,
      limiter: { tarpitAfter: 100 },
    };
    app = await buildApp({
      config: testConfig({
        REDIS_URL: redisBox.getConnectionUrl(),
        TRUST_PROXY_HOPS: '1',
        LOG_LEVEL: 'info',
      }),
      verifier: jwt,
      sessionAuthority: authority,
      assertIssuance: () => assertRedisForAuthIssuance(redis),
      driverAuth: runtime,
      healthChecks: [],
    });
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await redis.quit().catch(() => redis.disconnect());
    await identityPool.end();
    await ownerPool.end();
    await redisBox.stop();
    await pgRoles.postgres.stop();
  });

  async function seedDriver(
    username: string,
    opts: { status?: 'active' | 'inactive'; hash?: string } = {},
  ): Promise<{ accountId: string; username: string }> {
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'driver', $2, $3, $4, 0, false, now())`,
      [
        accountId,
        `+9891${accountId.replace(/-/g, '').slice(0, 8)}`,
        username,
        opts.status ?? 'active',
      ],
    );
    await ownerPool.query(
      `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash)
       VALUES ($1, $2, $3)`,
      [accountId, DIST, opts.hash ?? passwordHash],
    );
    return { accountId, username };
  }

  async function login(
    username: string,
    password = PASSWORD,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/v1/driver/auth/login',
      payload: { username, password },
      headers,
    });
  }

  it('C1 issues a session; C2 rotates then grace-replays without a new RT; G6 validates real bodies', async () => {
    const { username, accountId } = await seedDriver(`drv-${randomUUID().slice(0, 8)}`);
    const first = await login(username);
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.refreshExpiresAt).toEqual(expect.any(String));
    expect(body.driver.distributorId).toBe(DIST);
    const live = await redis.keys('sess:live:*');
    expect(live.length).toBeGreaterThan(0);
    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: body.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).toEqual(expect.any(String));
    const grace = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: body.refreshToken },
    });
    expect(grace.statusCode).toBe(200);
    expect(grace.json().refreshToken).toBeUndefined();
    expect(grace.json().refreshExpiresAt).toBeUndefined();
    const { login: loginSchema, refresh: refreshSchema } = loadAjv();
    expect(loginSchema(body)).toBe(true);
    expect(refreshSchema(rotated.json())).toBe(true);
    expect(refreshSchema(grace.json())).toBe(true);
    const audits = await ownerPool.query<{ action: string; data: unknown }>(
      `SELECT action, data FROM platform.audit_log WHERE actor_id = $1`,
      [accountId],
    );
    expect(audits.rows.map((row) => row.action)).toContain('login_success');
    expect(JSON.stringify(audits.rows)).not.toMatch(/refreshToken|correct-horse|\+9891/);
    expect(JSON.stringify(audits.rows)).toContain(
      hashUsernameForAudit(username, TEST_AUDIT_HASH_KEY),
    );
  });

  it('AUTH-LG-02: uniform 401 compares status, headers and body', async () => {
    const { username } = await seedDriver(`unk-${randomUUID().slice(0, 8)}`);
    const unknown = await login('no-such-user', PASSWORD);
    const wrong = await login(username, 'wrong-password-99');
    const inactive = await seedDriver(`ina-${randomUUID().slice(0, 8)}`, { status: 'inactive' });
    const dead = await login(inactive.username);
    for (const response of [unknown, wrong, dead]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
    }
    expect(wrong.json()).toEqual(unknown.json());
    expect(dead.json()).toEqual(unknown.json());
    expect(wrong.headers['content-type']).toBe(unknown.headers['content-type']);
    expect(dead.headers['content-type']).toBe(unknown.headers['content-type']);
    expect(headerNames(wrong)).toEqual(headerNames(unknown));
    expect(headerNames(dead)).toEqual(headerNames(unknown));
  });

  it('AUTH-LG-02-PR: unknown vs wrong vs inactive p95 timing overlap', async () => {
    const wrongUsers: string[] = [];
    const deadUsers: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      wrongUsers.push((await seedDriver(`tw-${randomUUID().slice(0, 8)}`)).username);
      deadUsers.push(
        (await seedDriver(`td-${randomUUID().slice(0, 8)}`, { status: 'inactive' })).username,
      );
    }
    const p95 = async (users: string[], password: string) => {
      const times: number[] = [];
      for (const user of users) {
        const start = performance.now();
        const response = await login(user, password);
        times.push(performance.now() - start);
        expect(response.statusCode).toBe(401);
      }
      times.sort((a, b) => a - b);
      return times[Math.ceil(0.95 * times.length) - 1] ?? 0;
    };
    const unknown = await p95(
      Array.from({ length: 8 }, () => `gone-${randomUUID().slice(0, 8)}`),
      PASSWORD,
    );
    const wrong = await p95(wrongUsers, 'wrong-password-99');
    const dead = await p95(deadUsers, PASSWORD);
    expect(Math.abs(unknown - wrong)).toBeLessThan(50);
    expect(Math.abs(unknown - dead)).toBeLessThan(50);
  }, 60_000);

  it('V11-O2-01: over-long username or password is invalid_credentials before lookup', async () => {
    const response = await login('x'.repeat(65), PASSWORD);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
    const longPw = await login('any-user', 'é'.repeat(80));
    expect(longPw.statusCode).toBe(401);
    expect(longPw.json()).toEqual(response.json());
  });

  it('C1 Redis-down fail-closes with no session row', async () => {
    const { username } = await seedDriver(`dn-${randomUUID().slice(0, 8)}`);
    const isolated = await buildApp({
      config: testConfig(),
      verifier: jwt,
      sessionAuthority: runtime.authority,
      assertIssuance: () => assertRedisForAuthIssuance(createRedis('redis://127.0.0.1:1')),
      driverAuth: runtime,
      healthChecks: [],
    });
    try {
      const before = await identityPool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM identity.sessions`,
      );
      const response = await isolated.inject({
        method: 'POST',
        url: '/v1/driver/auth/login',
        payload: { username, password: PASSWORD },
      });
      expect(response.statusCode).toBe(503);
      const after = await identityPool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM identity.sessions`,
      );
      expect(after.rows[0]?.c).toBe(before.rows[0]?.c);
    } finally {
      await isolated.close();
    }
  });

  it('LIM-T-01: 6th failure from IP1 is 429 + Retry-After; lockout audit has hashed username', async () => {
    const { username, accountId } = await seedDriver(`lok-${randomUUID().slice(0, 8)}`);
    const ip = '203.0.113.10';
    for (let i = 0; i < 5; i += 1) {
      await expect(
        loginDriver(runtime, { username, password: 'bad-password-xx', ip }),
      ).rejects.toMatchObject({ statusCode: 401, code: 'invalid_credentials' });
    }
    const limited = await login(username, PASSWORD, { 'x-forwarded-for': ip });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    expect(limited.headers['retry-after']).toBeDefined();
    const other = await seedDriver(`ok-${randomUUID().slice(0, 8)}`);
    const ok = await loginDriver(runtime, {
      username: other.username,
      password: PASSWORD,
      ip,
    });
    expect(ok.refreshToken).toEqual(expect.any(String));
    const audits = await ownerPool.query<{ action: string; data: unknown }>(
      `SELECT action, data FROM platform.audit_log WHERE actor_id = $1`,
      [accountId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['login_failure', 'login_lockout']),
    );
    expect(JSON.stringify(audits.rows)).toContain(
      hashUsernameForAudit(username, TEST_AUDIT_HASH_KEY),
    );
    expect(JSON.stringify(audits.rows)).not.toContain(username);
    const e3 = await ownerPool.query(
      `SELECT 1 FROM platform.outbox_events WHERE payload->>'reason' = 'lockout'`,
    );
    expect(e3.rowCount).toBe(0);
    const sessions = await ownerPool.query(
      `SELECT 1 FROM identity.sessions WHERE account_id = $1`,
      [accountId],
    );
    expect(sessions.rowCount).toBe(0);
  });

  it('LIM-T-02: per-IP failures-only cap is 429; successes never count', async () => {
    const tight: DriverAuthRuntime = {
      ...runtime,
      limiter: { ipFails: 3, userIpFails: 99, tarpitAfter: 100 },
    };
    const a = await seedDriver(`ipa-${randomUUID().slice(0, 8)}`);
    const b = await seedDriver(`ipb-${randomUUID().slice(0, 8)}`);
    const ip = '198.51.100.9';
    await loginDriver(tight, { username: a.username, password: PASSWORD, ip });
    await expect(
      loginDriver(tight, { username: a.username, password: 'bad-1', ip }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      loginDriver(tight, { username: b.username, password: 'bad-2', ip }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      loginDriver(tight, { username: b.username, password: 'bad-3', ip }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      loginDriver(tight, { username: a.username, password: 'bad-4', ip }),
    ).rejects.toMatchObject({ statusCode: 429, code: 'too_many_attempts' });
  });

  it('R12-2: request.ip is the client from the configured LB hop', async () => {
    const { username } = await seedDriver(`xff-${randomUUID().slice(0, 8)}`);
    const response = await login(username, 'bad-password-xx', {
      'x-forwarded-for': '203.0.113.50',
    });
    expect(response.statusCode).toBe(401);
    const row = await ownerPool.query<{ ip: string }>(
      `SELECT ip FROM platform.audit_log WHERE action = 'login_failure' ORDER BY at DESC LIMIT 1`,
    );
    expect(row.rows[0]?.ip).toBe('203.0.113.50');
  });

  it('R13-3: multi-entry XFF spoof uses the configured hop, not the attacker', async () => {
    const { username } = await seedDriver(`spoof-${randomUUID().slice(0, 8)}`);
    const response = await login(username, 'bad-password-xx', {
      'x-forwarded-for': '198.51.100.1, 203.0.113.50',
    });
    expect(response.statusCode).toBe(401);
    const row = await ownerPool.query<{ ip: string }>(
      `SELECT ip FROM platform.audit_log WHERE action = 'login_failure' ORDER BY at DESC LIMIT 1`,
    );
    expect(row.rows[0]?.ip).toBe('203.0.113.50');
    expect(row.rows[0]?.ip).not.toBe('198.51.100.1');
  });

  it('R13-3: hops=0 ignores X-Forwarded-For', async () => {
    const { username } = await seedDriver(`hop0-${randomUUID().slice(0, 8)}`);
    const isolated = await buildApp({
      config: testConfig({
        REDIS_URL: redisBox.getConnectionUrl(),
        TRUST_PROXY_HOPS: '0',
      }),
      verifier: jwt,
      sessionAuthority: runtime.authority,
      assertIssuance: () => assertRedisForAuthIssuance(redis),
      driverAuth: runtime,
      healthChecks: [],
    });
    try {
      const response = await isolated.inject({
        method: 'POST',
        url: '/v1/driver/auth/login',
        payload: { username, password: 'bad-password-xx' },
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      expect(response.statusCode).toBe(401);
      const row = await ownerPool.query<{ ip: string }>(
        `SELECT ip FROM platform.audit_log WHERE action = 'login_failure' ORDER BY at DESC LIMIT 1`,
      );
      expect(row.rows[0]?.ip).not.toBe('203.0.113.50');
    } finally {
      await isolated.close();
    }
  });

  it('R2-1 / R13-1: 50 parallel bad logins; at most 5 reach the hasher', async () => {
    const { username } = await seedDriver(`par-${randomUUID().slice(0, 8)}`);
    let verifies = 0;
    const counting: DriverAuthRuntime = {
      ...runtime,
      hasher: {
        hash: (plain) => hasher.hash(plain),
        verify: async (hash, plain) => {
          verifies += 1;
          return hasher.verify(hash, plain);
        },
      },
    };
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        loginDriver(counting, { username, password: 'bad-password-xx', ip: '203.0.113.80' }),
      ),
    );
    expect(verifies).toBeLessThanOrEqual(5);
    expect(results.filter((row) => row.status === 'rejected').length).toBe(50);
  });

  it('N5 / AUTH-DM-01: A5/B5 are not registered in production', async () => {
    const prod = await buildApp({ config: productionApiConfig(), healthChecks: [] });
    try {
      expect(prod.hasRoute({ method: 'POST', url: '/v1/app/auth/demo' })).toBe(false);
      expect(prod.hasRoute({ method: 'POST', url: '/v1/admin/auth/demo' })).toBe(false);
      const a5 = await prod.inject({ method: 'POST', url: '/v1/app/auth/demo' });
      const unknown = await prod.inject({ method: 'POST', url: '/no-such-demo-route' });
      expect(a5.statusCode).toBe(404);
      expect(a5.json()).toEqual(unknown.json());
    } finally {
      await prod.close();
    }
  });

  it('C2 U1/9-16/L1/F13-1/F13-2: uniform 401, typ mismatch, exact 503, reuse after failed drain', async () => {
    const { username } = await seedDriver(`c2-${randomUUID().slice(0, 8)}`);
    const issued = await login(username);
    const rt = issued.json().refreshToken as string;
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: 'b'.repeat(43) },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toMatchObject({ error: { code: 'invalid_credentials' } });

    const shop = await runtime.store.issue({
      accountId: issued.json().driver.id,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    await runtime.store.rotate(shop.refreshToken, 'shopkeeper');
    const mismatch = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: shop.refreshToken },
    });
    expect(mismatch.statusCode).toBe(401);
    expect(mismatch.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });
    const family = await identityPool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.sessions WHERE family_id = $1`,
      [shop.familyId],
    );
    expect(family.rows[0]?.revoked_at).toBeNull();

    const locker = await identityPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT set_config($1, $2, true)', ['lock_timeout', '15s']);
      await locker.query(`SELECT hash FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`, [
        hashRefreshToken(rt),
      ]);
      const locked = await app.inject({
        method: 'POST',
        url: '/v1/driver/auth/refresh',
        payload: { refreshToken: rt },
      });
      expect(locked.statusCode).toBe(503);
      expect(locked.headers['retry-after']).toBeDefined();
      await locker.query('ROLLBACK');
    } finally {
      locker.release();
    }

    const failing = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: async () => {
        throw new Error('drain down');
      },
      log: silentDrainLog,
    });
    const { accountId } = await seedDriver(`drn-${randomUUID().slice(0, 8)}`);
    const first = await failing.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'driver',
    });
    await failing.rotate(first.refreshToken, 'driver');
    const reuse = await failing.rotate(
      first.refreshToken,
      'driver',
      () => new Date(Date.now() + 21_000),
    );
    expect(reuse).toMatchObject({ status: 'rejected', reason: 'reuse' });

    const a = app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: rt },
    });
    const b = app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: rt },
    });
    const settled = await Promise.all([a, b]);
    expect(settled.some((row) => row.statusCode === 200)).toBe(true);
    const unused = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.refresh_tokens t
        JOIN identity.sessions s ON s.sid = t.sid
       WHERE s.account_id = $1 AND s.typ = 'driver' AND t.rotated_at IS NULL`,
      [issued.json().driver.id],
    );
    expect(Number(unused.rows[0]?.c)).toBe(1);
  }, 20_000);

  it('R2-4: default cap of 2 holds under parallel logins', async () => {
    const { username, accountId } = await seedDriver(`pcap-${randomUUID().slice(0, 8)}`);
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        loginDriver(runtime, { username, password: PASSWORD, ip: `10.4.4.${i + 1}` }),
      ),
    );
    expect(settled.some((row) => row.status === 'fulfilled')).toBe(true);
    const open = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.sessions WHERE account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    expect(Number(open.rows[0]?.c)).toBeLessThanOrEqual(2);
  });

  it('R2-4: login and issue paths return 503 with Retry-After on lock timeout', async () => {
    const { username, accountId } = await seedDriver(`l503-${randomUUID().slice(0, 8)}`);
    const throwingPool = {
      query: (text: string, params?: unknown[]) => {
        if (typeof text === 'string' && text.includes('lookup_driver_login')) {
          return Promise.reject(Object.assign(new Error('lock timeout'), { code: '55P03' }));
        }
        return identityPool.query(text, params as never);
      },
    } as unknown as typeof identityPool;
    await expect(
      loginDriver(
        { ...runtime, identityPool: throwingPool },
        { username, password: PASSWORD, ip: '10.5.5.1' },
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      details: { retryAfter: expect.any(Number) },
    });

    const locker = await identityPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT set_config($1, $2, true)', ['lock_timeout', '15s']);
      await locker.query(`SELECT id FROM identity.accounts WHERE id = $1 FOR UPDATE`, [accountId]);
      const issued = await login(username, PASSWORD);
      expect(issued.statusCode).toBe(503);
      expect(issued.headers['retry-after']).toBeDefined();
    } finally {
      await locker.query('ROLLBACK').catch(() => {});
      locker.release();
    }
  }, 15_000);

  it('RT-05: default DRIVER_MAX_SESSIONS=2 revokes the oldest with session_limit audit+E3', async () => {
    const { username, accountId } = await seedDriver(`cap-${randomUUID().slice(0, 8)}`);
    await loginDriver(runtime, { username, password: PASSWORD, ip: '10.1.1.1' });
    await loginDriver(runtime, { username, password: PASSWORD, ip: '10.1.1.2' });
    await loginDriver(runtime, { username, password: PASSWORD, ip: '10.1.1.3' });
    const rows = await ownerPool.query<{ revoke_reason: string | null }>(
      `SELECT revoke_reason FROM identity.sessions WHERE account_id = $1 ORDER BY created_at`,
      [accountId],
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows[0]?.revoke_reason).toBe('session_limit');
    expect(rows.rows[1]?.revoke_reason).toBeNull();
    expect(rows.rows[2]?.revoke_reason).toBeNull();
    const audit = await ownerPool.query(
      `SELECT 1 FROM platform.audit_log WHERE actor_id = $1 AND action = 'session_limit'`,
      [accountId],
    );
    expect((audit.rowCount ?? 0) > 0).toBe(true);
    const e3 = await ownerPool.query(
      `SELECT 1 FROM platform.outbox_events
        WHERE payload->>'accountId' = $1 AND payload->>'reason' = 'session_limit'`,
      [accountId],
    );
    expect((e3.rowCount ?? 0) > 0).toBe(true);
  });

  it('R12-10: live-cache write failure revokes only the new session, no session_version bump', async () => {
    const { username, accountId } = await seedDriver(`live-${randomUUID().slice(0, 8)}`);
    const first = await loginDriver(runtime, { username, password: PASSWORD, ip: '10.9.9.1' });
    expect(first.refreshToken).toEqual(expect.any(String));
    const before = await ownerPool.query<{ session_version: number }>(
      `SELECT session_version FROM identity.accounts WHERE id = $1`,
      [accountId],
    );
    const broken: DriverAuthRuntime = {
      ...runtime,
      authority: {
        hasPgFallback: true,
        check: (sid, sv, options) => runtime.authority.check(sid, sv, options),
        rememberLive: async () => {
          throw new Error('live cache down');
        },
        deny: (sids) => runtime.authority.deny(sids),
        invalidateLive: (sids) => runtime.authority.invalidateLive(sids),
        breakerState: () => runtime.authority.breakerState(),
        pgFallbackTotal: () => runtime.authority.pgFallbackTotal(),
        pgLookupsFor: (sid) => runtime.authority.pgLookupsFor(sid),
      },
    };
    await expect(
      loginDriver(broken, { username, password: PASSWORD, ip: '10.9.9.2' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    const after = await ownerPool.query<{ session_version: number }>(
      `SELECT session_version FROM identity.accounts WHERE id = $1`,
      [accountId],
    );
    expect(after.rows[0]?.session_version).toBe(before.rows[0]?.session_version);
    const open = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.sessions WHERE account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    expect(Number(open.rows[0]?.c)).toBe(1);
  });

  it('B5 / 9-5 / R13-4: reset between verify and issue aborts with no session', async () => {
    const weak = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 8,
      timeCost: 1,
      parallelism: 1,
    });
    const { username, accountId } = await seedDriver(`cas-${randomUUID().slice(0, 8)}`, {
      hash: weak,
    });
    const resetHash = await hasher.hash('reset-horse-99');
    const racing: DriverAuthRuntime = {
      ...runtime,
      hasher: {
        hash: (plain) => hasher.hash(plain),
        verify: async (hash, plain) => {
          const ok = await hasher.verify(hash, plain);
          await ownerPool.query(
            `UPDATE identity.driver_credentials SET password_hash = $2 WHERE account_id = $1`,
            [accountId, resetHash],
          );
          return ok;
        },
      },
    };
    await expect(
      loginDriver(racing, { username, password: PASSWORD, ip: '10.8.8.1' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'invalid_credentials' });
    const stored = await ownerPool.query<{ password_hash: string }>(
      `SELECT password_hash FROM identity.driver_credentials WHERE account_id = $1`,
      [accountId],
    );
    expect(stored.rows[0]?.password_hash).toBe(resetHash);
    const created = await ownerPool.query(`SELECT 1 FROM identity.sessions WHERE account_id = $1`, [
      accountId,
    ]);
    expect(created.rowCount).toBe(0);

    const dead = await seedDriver(`casd-${randomUUID().slice(0, 8)}`, { hash: weak });
    await ownerPool.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [
      dead.accountId,
    ]);
    await expect(
      runtime.store.issue({
        accountId: dead.accountId,
        sid: randomUUID(),
        familyId: randomUUID(),
        typ: 'driver',
        distributorId: DIST,
        requireActive: true,
        verifiedPasswordHash: weak,
      }),
    ).rejects.toMatchObject({ code: 'ISSUE_ABORTED' });
    const deadSessions = await ownerPool.query(
      `SELECT 1 FROM identity.sessions WHERE account_id = $1`,
      [dead.accountId],
    );
    expect(deadSessions.rowCount).toBe(0);
  });

  it('G7: captured logs contain no token, hash, OTP or full phone', async () => {
    const chunks: string[] = [];
    const log = pino(pinoOptions({ LOG_LEVEL: 'info' }), {
      write(chunk: string) {
        chunks.push(chunk);
      },
    });
    log.info(
      {
        refreshToken: 'secret-rt',
        accessToken: 'secret-at',
        otp: '123456',
        hash: '$argon2id$v=19$m=19456',
        phone: '+989121234567',
      },
      'login',
    );
    const blob = chunks.join('\n');
    expect(blob).toMatch(/\[REDACTED\]/);
    expect(blob).not.toMatch(/secret-rt|secret-at|123456|\$argon2id\$|\+989121234567/i);
    const audits = await ownerPool.query<{ data: unknown }>(
      `SELECT data FROM platform.audit_log WHERE action IN ('login_success', 'login_failure', 'login_lockout')`,
    );
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /correct-horse|refreshToken|\$argon2id\$|\+9891[0-9]{8}|otp/i,
    );
  });
});
