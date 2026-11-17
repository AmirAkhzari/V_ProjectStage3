import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { buildApp, type App } from '../../src/app.js';
import type { DriverAuthRuntime } from '../../src/modules/identity/application/driverAuth.js';
import { TEST_AUDIT_HASH_KEY } from '../../src/modules/identity/domain/loginPolicy.js';
import { Argon2idPasswordHasher } from '../../src/modules/identity/infra/crypto/argon2Hasher.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import {
  PgSessionStore,
  silentDrainLog,
} from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import { RedisPgSessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import { startPostgresWithRoles, type StartedPostgresRoles } from '../helpers/containers.js';

const DIST = '12121212-1212-1212-1212-121212121212';
const TEMP = 'pw-temp-aaaaaa';
const NEW = 'pw-new-bbbbbbbb';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

describe('Slice 3a C11 POST /v1/driver/auth/password', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let runtime: DriverAuthRuntime;
  let app: App;

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    redisBox = await new RedisContainer('redis:7-alpine').start();
    identityPool = new pg.Pool({ connectionString: pgRoles.identityUrl });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl });
    redis = createRedis(redisBox.getConnectionUrl());
    await redis.connect();
    const authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    const jwt = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [await generateEd25519Key('k1')],
    });
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at) VALUES ($1, 'Dist C11', 'active', now())`,
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
      hasher: new Argon2idPasswordHasher(),
      log: silentDrainLog,
      auditHashKey: TEST_AUDIT_HASH_KEY,
      limiter: { tarpitAfter: 100 },
    };
    app = await buildApp({
      config: testConfig({ REDIS_URL: redisBox.getConnectionUrl(), LOG_LEVEL: 'silent' }),
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
  async function seedDriver(mustChangePassword: boolean, tempExpiresAt: Date | null) {
    const accountId = randomUUID();
    const username = `drv-${randomUUID().slice(0, 8)}`;
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'driver', $2, $3, 'active', 0, $4, now())`,
      [accountId, `+9892${accountId.replace(/-/g, '').slice(0, 8)}`, username, mustChangePassword],
    );
    await ownerPool.query(
      `INSERT INTO identity.driver_credentials
         (account_id, distributor_id, password_hash, temp_expires_at) VALUES ($1, $2, $3, $4)`,
      [accountId, DIST, await runtime.hasher.hash(TEMP), tempExpiresAt],
    );
    const login = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/login',
      payload: { username, password: TEMP },
    });
    expect(login.statusCode, login.body).toBe(200);
    return { accountId, session: login.json() as Record<string, string | boolean> };
  }
  const change = (accessToken: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/v1/driver/auth/password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });
  it('C11-01/C11-02: flag cleared, expiry preserved, old AT/RT dead, audit + E3', async () => {
    const seeded = await seedDriver(true, FUTURE);
    const before = seeded.session as {
      accessToken: string;
      refreshToken: string;
      absoluteExpiresAt: string;
    };
    const response = await change(before.accessToken, { currentPassword: TEMP, newPassword: NEW });
    expect(response.statusCode, response.body).toBe(200);
    const after = response.json() as typeof before & { mustChangePassword: boolean };
    expect(after.mustChangePassword).toBe(false);
    // The absolute expiry is inherited from the original login, not reset.
    expect(after.absoluteExpiresAt).toBe(before.absoluteExpiresAt);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    const row = await ownerPool.query<{
      temp_expires_at: Date | null;
      must_change_password: boolean;
    }>(
      `SELECT a.must_change_password, c.temp_expires_at
         FROM identity.accounts a JOIN identity.driver_credentials c ON c.account_id = a.id
        WHERE a.id = $1`,
      [seeded.accountId],
    );
    expect(row.rows[0]).toMatchObject({ must_change_password: false, temp_expires_at: null });
    const audit = await ownerPool.query(
      `SELECT 1 FROM platform.audit_log WHERE actor_id = $1 AND action = 'driver_password_changed'`,
      [seeded.accountId],
    );
    expect(audit.rows).toHaveLength(1);
    const outbox = await ownerPool.query<{ reason: string }>(
      `SELECT payload->>'reason' AS reason FROM platform.outbox_events
        WHERE event_type = 'identity.sessions_revoked' AND payload->>'accountId' = $1`,
      [seeded.accountId],
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
    expect(outbox.rows.every((r) => r.reason === 'password_change')).toBe(true);
    const oldAt = await app.inject({
      method: 'GET',
      url: '/v1/driver/no-such-route',
      headers: { authorization: `Bearer ${before.accessToken}` },
    });
    expect(oldAt.statusCode).toBe(401);
    expect(oldAt.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
    const oldRt = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: before.refreshToken },
    });
    expect(oldRt.statusCode).toBe(401);
  });

  it('C11-03: five wrong current passwords then 429 too_many_attempts + Retry-After', async () => {
    const seeded = await seedDriver(true, FUTURE);
    const token = (seeded.session as { accessToken: string }).accessToken;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await change(token, { currentPassword: 'pw-wrong-cccccc', newPassword: NEW });
      expect(wrong.statusCode).toBe(422);
      expect(wrong.json()).toMatchObject({ error: { code: 'CURRENT_PASSWORD_INVALID' } });
    }
    const blocked = await change(token, { currentPassword: TEMP, newPassword: NEW });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('expired temp: 422 CURRENT_PASSWORD_INVALID', async () => {
    const seeded = await seedDriver(true, new Date(Date.now() - 60_000));
    const token = (seeded.session as { accessToken: string }).accessToken;
    const response = await change(token, { currentPassword: TEMP, newPassword: NEW });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'CURRENT_PASSWORD_INVALID' } });
  });

  it('Redis down fails closed with 503 SERVICE_UNAVAILABLE', async () => {
    const seeded = await seedDriver(true, FUTURE);
    const token = (seeded.session as { accessToken: string }).accessToken;
    const real = runtime.redis;
    (runtime as { redis: unknown }).redis = {
      status: 'close',
      connect: async () => {
        throw new Error('down');
      },
      ping: async () => {
        throw new Error('down');
      },
    };
    try {
      const response = await change(token, { currentPassword: TEMP, newPassword: NEW });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      (runtime as { redis: unknown }).redis = real;
    }
  });

  it('C11-05: must-change driver is 403 PASSWORD_CHANGE_REQUIRED on C3 logout', async () => {
    const seeded = await seedDriver(true, FUTURE);
    const token = (seeded.session as { accessToken: string }).accessToken;
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
  });
});
