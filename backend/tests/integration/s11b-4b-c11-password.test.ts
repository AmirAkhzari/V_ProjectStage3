import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyPluginAsync } from 'fastify';
import type { RouteRegistryRow } from '../../src/platform/http/routeRegistry.js';
import { loadBreachedPasswordList } from '../../src/modules/identity/infra/crypto/breachedPasswords.js';
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
  const logLines: string[] = [];
  // Test-only driver probe (P6-5); not a contract route.
  const probe: FastifyPluginAsync = async (app) => {
    app.get('/test/payouts', { schema: { operationId: 'TEST_DRIVER_PROBE' } }, async () => ({
      ok: true,
    }));
  };
  const probeRows: readonly RouteRegistryRow[] = [
    {
      operationId: 'TEST_DRIVER_PROBE',
      method: 'GET',
      path: '/v1/driver/test/payouts',
      access: { kind: 'authenticated', subject: 'driver' },
    },
  ];

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
      breachedPassword: loadBreachedPasswordList().has,
    };
    app = await buildApp({
      config: testConfig({ REDIS_URL: redisBox.getConnectionUrl(), LOG_LEVEL: 'info' }),
      logDestination: { write: (line: string) => logLines.push(line) },
      driverTestRoutes: probe,
      testRegistryRows: probeRows,
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
    // P6-5: must-change blocks the probe; C11 itself still works with the same token.
    const mustChange = await app.inject({
      method: 'GET',
      url: '/v1/driver/test/payouts',
      headers: { authorization: `Bearer ${before.accessToken}` },
    });
    expect(mustChange.statusCode).toBe(403);
    expect(mustChange.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
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
    // P6-1/L-6-2: the NEW session is not a revoke victim and can rotate.
    const fresh = await app.inject({
      method: 'GET',
      url: '/v1/driver/test/payouts',
      headers: { authorization: `Bearer ${after.accessToken}` },
    });
    expect(fresh.statusCode, fresh.body).toBe(200);
    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/refresh',
      payload: { refreshToken: after.refreshToken },
    });
    expect(rotated.statusCode, rotated.body).toBe(200);
    const newest = (rotated.json() as { accessToken: string }).accessToken;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/driver/test/payouts',
          headers: { authorization: `Bearer ${newest}` },
        })
      ).statusCode,
    ).toBe(200);
    // E3/audit only for prior families: the new familyId is not in the revoke outbox.
    const newSid = await ownerPool.query<{ sid: string }>(
      `SELECT sid FROM identity.sessions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [seeded.accountId],
    );
    const revokedSids = await ownerPool.query<{ sid: string }>(
      `SELECT payload->>'sid' AS sid FROM platform.outbox_events
        WHERE event_type = 'identity.sessions_revoked' AND payload->>'accountId' = $1`,
      [seeded.accountId],
    );
    expect(revokedSids.rows.map((r) => r.sid)).not.toContain(newSid.rows[0]?.sid);
    const username = await ownerPool.query<{ username_norm: string }>(
      `SELECT username_norm FROM identity.accounts WHERE id = $1`,
      [seeded.accountId],
    );
    const loginNew = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/login',
      payload: { username: username.rows[0]!.username_norm, password: NEW },
    });
    expect(loginNew.statusCode, loginNew.body).toBe(200);
    for (const password of [TEMP, 'pw-stale-dddddd']) {
      const loginOld = await app.inject({
        method: 'POST',
        url: '/v1/driver/auth/login',
        payload: { username: username.rows[0]!.username_norm, password },
      });
      expect(loginOld.statusCode).toBe(401);
    }
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

  it('P6-2: policy rejects with the correct current do not count toward C1', async () => {
    const seeded = await seedDriver(true, FUTURE);
    const token = (seeded.session as { accessToken: string }).accessToken;
    const username = await ownerPool.query<{ username_norm: string }>(
      `SELECT username_norm FROM identity.accounts WHERE id = $1`,
      [seeded.accountId],
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await change(token, { currentPassword: TEMP, newPassword: 'abc1234' });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.json()).toMatchObject({ error: { code: 'PASSWORD_TOO_SHORT' } });
    }
    const login = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/login',
      payload: { username: username.rows[0]!.username_norm, password: TEMP },
    });
    expect(login.statusCode, login.body).toBe(200);
  });

  it('P6-3: no egress, no secret leakage, and a failed audit insert rolls back', async () => {
    const seeded = await seedDriver(true, FUTURE);
    const before = seeded.session as { accessToken: string; refreshToken: string };
    const realFetch = globalThis.fetch;
    const realHttp = http.request;
    const realHttps = https.request;
    const block = () => {
      throw new Error('egress blocked');
    };
    globalThis.fetch = (async () => block()) as typeof fetch;
    http.request = block as typeof http.request;
    https.request = block as typeof https.request;
    const tempHash = (
      await ownerPool.query<{ password_hash: string }>(
        `SELECT password_hash FROM identity.driver_credentials WHERE account_id = $1`,
        [seeded.accountId],
      )
    ).rows[0]!.password_hash;
    logLines.length = 0;
    let okBody: string | undefined;
    try {
      const ok = await change(before.accessToken, { currentPassword: TEMP, newPassword: NEW });
      expect(ok.statusCode, ok.body).toBe(200);
      okBody = ok.body;
      expect(ok.body).not.toContain(TEMP);
      expect(ok.body).not.toContain(NEW);
      expect(ok.body).not.toContain(tempHash);
    } finally {
      globalThis.fetch = realFetch;
      http.request = realHttp;
      https.request = realHttps;
    }
    const after = JSON.parse(okBody ?? '') as { accessToken: string; refreshToken: string };
    const newHash = (
      await ownerPool.query<{ password_hash: string }>(
        `SELECT password_hash FROM identity.driver_credentials WHERE account_id = $1`,
        [seeded.accountId],
      )
    ).rows[0]!.password_hash;
    const liveSids = await ownerPool.query<{ sid: string }>(
      `SELECT sid FROM identity.sessions WHERE account_id = $1 AND revoked_at IS NULL`,
      [seeded.accountId],
    );
    const auditText = (
      await ownerPool.query<{ data: string }>(
        `SELECT data::text AS data FROM platform.audit_log WHERE actor_id = $1`,
        [seeded.accountId],
      )
    ).rows
      .map((r) => r.data)
      .join('');
    const secrets = [TEMP, NEW, tempHash, newHash, before.accessToken, before.refreshToken];
    const scanned = `${logLines.join('')}\n${auditText}`;
    for (const secret of secrets) expect(scanned).not.toContain(secret);
    // Rollback: a failing audit insert must undo credential/session changes.
    await ownerPool.query(`
      CREATE OR REPLACE FUNCTION platform.c11_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'driver_password_changed' THEN RAISE EXCEPTION 'c11 audit fail'; END IF; RETURN NEW; END $$`);
    await ownerPool.query(`CREATE TRIGGER c11_audit_fail BEFORE INSERT ON platform.audit_log
      FOR EACH ROW EXECUTE FUNCTION platform.c11_audit_fail()`);
    try {
      const failed = await change(after.accessToken, {
        currentPassword: NEW,
        newPassword: 'pw-new-eeeeeeee',
      });
      expect(failed.statusCode).toBeGreaterThanOrEqual(500);
      const failScan = `${failed.body}\n${logLines.join('')}`;
      for (const secret of [...secrets, 'pw-new-eeeeeeee', after.accessToken, after.refreshToken]) {
        expect(failScan).not.toContain(secret);
      }
      const row = await ownerPool.query<{
        password_hash: string;
        must_change_password: boolean;
        temp_expires_at: Date | null;
      }>(
        `SELECT c.password_hash, a.must_change_password, c.temp_expires_at
           FROM identity.accounts a JOIN identity.driver_credentials c ON c.account_id = a.id
          WHERE a.id = $1`,
        [seeded.accountId],
      );
      expect(row.rows[0]).toMatchObject({
        password_hash: newHash,
        must_change_password: false,
        temp_expires_at: null,
      });
      const stillLive = await ownerPool.query<{ sid: string }>(
        `SELECT sid FROM identity.sessions WHERE account_id = $1 AND revoked_at IS NULL ORDER BY sid`,
        [seeded.accountId],
      );
      expect(stillLive.rows.map((r) => r.sid).sort()).toEqual(
        liveSids.rows.map((r) => r.sid).sort(),
      );
      const audit = await ownerPool.query(
        `SELECT 1 FROM platform.audit_log WHERE actor_id = $1 AND action = 'driver_password_changed'`,
        [seeded.accountId],
      );
      expect(audit.rows).toHaveLength(1);
    } finally {
      await ownerPool.query(`DROP TRIGGER IF EXISTS c11_audit_fail ON platform.audit_log`);
      await ownerPool.query(`DROP FUNCTION IF EXISTS platform.c11_audit_fail()`);
    }
    const login = await ownerPool.query<{ username_norm: string }>(
      `SELECT username_norm FROM identity.accounts WHERE id = $1`,
      [seeded.accountId],
    );
    const stillNew = await app.inject({
      method: 'POST',
      url: '/v1/driver/auth/login',
      payload: { username: login.rows[0]!.username_norm, password: NEW },
    });
    expect(stillNew.statusCode).toBe(200);
  });

  // C11-05 (must-change driver blocked on other driver routes) is covered at guard level in
  // tests/unit/route-access.test.ts; C3 itself stays PENDING (catch-all 404), not implemented.
});
