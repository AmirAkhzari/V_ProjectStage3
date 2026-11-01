import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { buildApp, type App } from '../../src/app.js';
import {
  loginDriver,
  type DriverAuthRuntime,
} from '../../src/modules/identity/application/driverAuth.js';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import { PgSessionStore } from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import {
  fallbackPoolOptions,
  RedisPgSessionAuthority,
} from '../../src/platform/auth/sessionAuthority.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST = '11111111-1111-1111-1111-111111111111';
const PASSWORD = 'correct-horse-12';

describe('S11b-4a driver C1/C2', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let jwt: EddsaAccessTokenService;
  let hasher: Argon2idPasswordHasher;
  let passwordHash: string;
  let runtime: DriverAuthRuntime;
  let app: App;

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool(fallbackPoolOptions(pgRoles.identityUrl));
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    appPool = new pg.Pool({ connectionString: pgRoles.appUrl });
    attachPgTeardownGuard(identityPool);
    attachPgTeardownGuard(ownerPool);
    attachPgTeardownGuard(appPool);
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
      appPool,
      redis,
      jwt,
      authority,
      store: new PgRefreshTokenStore(identityPool, {
        onSidsRevoked: (sids) => authority.deny(sids),
      }),
      hasher,
      rateUser: 8,
      rateIp: 40,
    };
    app = await buildApp({
      config: testConfig({ REDIS_URL: redisBox.getConnectionUrl() }),
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
    await appPool.end();
    await redisBox.stop();
    await pgRoles.postgres.stop();
  });

  async function seedDriver(
    username: string,
    opts: { status?: 'active' | 'inactive'; distName?: string } = {},
  ): Promise<{ accountId: string; username: string }> {
    const accountId = randomUUID();
    const distId = opts.distName ? randomUUID() : DIST;
    if (opts.distName) {
      await ownerPool.query(
        `INSERT INTO tenancy.distributors (id, name, status, created_at) VALUES ($1, $2, 'active', now())`,
        [distId, opts.distName],
      );
    }
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
      [accountId, distId, passwordHash],
    );
    return { accountId, username };
  }

  async function login(username: string, password = PASSWORD) {
    return app.inject({
      method: 'POST',
      url: '/v1/driver/auth/login',
      payload: { username, password },
    });
  }

  it('C1 issues a session; C2 rotates then grace-replays without a new RT', async () => {
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
    const audits = await ownerPool.query<{ action: string }>(
      `SELECT action FROM platform.audit_log WHERE actor_id = $1`,
      [accountId],
    );
    expect(audits.rows.map((row) => row.action)).toContain('login_success');
    expect(JSON.stringify(audits.rows)).not.toMatch(/refreshToken|correct-horse|\+9891/);
  });

  it('C1 is a uniform 401 for unknown, wrong password, inactive, and locked', async () => {
    const { username } = await seedDriver(`unk-${randomUUID().slice(0, 8)}`);
    const unknown = await login('no-such-user', PASSWORD);
    const wrong = await login(username, 'wrong-password-99');
    const inactive = await seedDriver(`ina-${randomUUID().slice(0, 8)}`, { status: 'inactive' });
    const dead = await login(inactive.username);
    expect([unknown.statusCode, wrong.statusCode, dead.statusCode]).toEqual([401, 401, 401]);
    expect(unknown.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
    expect(wrong.json()).toEqual(unknown.json());
    expect(dead.json()).toEqual(unknown.json());
    const lockUser = `lok-${randomUUID().slice(0, 8)}`;
    await seedDriver(lockUser);
    for (let i = 0; i < 5; i += 1) await login(lockUser, 'bad-password-xx');
    const locked = await login(lockUser);
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
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

  it('9-4: a username that matches a distributor name is invalid_credentials', async () => {
    const name = `dist-${randomUUID().slice(0, 8)}`;
    await seedDriver(`other-${randomUUID().slice(0, 8)}`, { distName: name });
    const response = await login(name);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
  });

  it('SESS-06: per-username rate limit is 429 with Retry-After', async () => {
    const tight: DriverAuthRuntime = { ...runtime, rateUser: 2 };
    const { username } = await seedDriver(`rl-${randomUUID().slice(0, 8)}`);
    await loginDriver(tight, { username, password: PASSWORD, ip: '10.0.0.9' });
    await loginDriver(tight, { username, password: PASSWORD, ip: '10.0.0.9' });
    await expect(
      loginDriver(tight, { username, password: PASSWORD, ip: '10.0.0.9' }),
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('C2 U1/9-16/L1/F13-1/F13-2: uniform 401, typ mismatch, reuse after failed drain, parallel end-state', async () => {
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

    const failing = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: async () => {
        throw new Error('drain down');
      },
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
    const codes = settled.map((row) => row.statusCode).sort();
    expect(codes[0]).toBe(200);
    expect([200, 401, 503]).toContain(codes[1]);
    const unused = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.refresh_tokens t
        JOIN identity.sessions s ON s.sid = t.sid
       WHERE s.account_id = $1 AND s.typ = 'driver' AND t.rotated_at IS NULL`,
      [issued.json().driver.id],
    );
    expect(Number(unused.rows[0]?.c)).toBe(1);
  });

  it('RT-05: the concurrent-session cap revokes the oldest with session_limit', async () => {
    const { username, accountId } = await seedDriver(`cap-${randomUUID().slice(0, 8)}`);
    const capped: DriverAuthRuntime = { ...runtime, maxSessions: 1 };
    await loginDriver(capped, { username, password: PASSWORD, ip: '10.1.1.1' });
    await loginDriver(capped, { username, password: PASSWORD, ip: '10.1.1.1' });
    const rows = await ownerPool.query<{ revoke_reason: string | null }>(
      `SELECT revoke_reason FROM identity.sessions WHERE account_id = $1 ORDER BY created_at`,
      [accountId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.revoke_reason).toBe('session_limit');
    expect(rows.rows[1]?.revoke_reason).toBeNull();
  });
});
