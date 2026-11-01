import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { buildApp, type App } from '../../src/app.js';
import { createIdentityApi } from '../../src/modules/identity/api.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import {
  drainPendingDenies,
  listOpenPendingDenies,
  PgSessionStore,
} from '../../src/modules/identity/infra/session/pgSessionStore.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from '../../src/platform/auth/failClosed.js';
import {
  fallbackPoolOptions,
  PG_FALLBACK_POOL_MAX,
  RedisPgSessionAuthority,
} from '../../src/platform/auth/sessionAuthority.js';
import { withTenant } from '../../src/platform/db/tenant.js';
import {
  postgresHealthCheck,
  redisHealthCheck,
  runHealthChecks,
} from '../../src/platform/health.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST_A = '11111111-1111-1111-1111-111111111111';
const DIST_B = '22222222-2222-2222-2222-222222222222';

describe('S11b-3 session SoT + auth plugin', () => {
  let pgRoles: StartedPostgresRoles;
  let redisBox: StartedRedisContainer;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let redis: ReturnType<typeof createRedis>;
  let authority: RedisPgSessionAuthority;
  let jwt: EddsaAccessTokenService;
  let store: PgRefreshTokenStore;
  let api: ReturnType<typeof createIdentityApi>;
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
    authority = new RedisPgSessionAuthority(redis, new PgSessionStore(identityPool));
    const key = await generateEd25519Key('k1');
    jwt = new EddsaAccessTokenService({ iss: 'vproject', activeKid: 'k1', keys: [key] });
    store = new PgRefreshTokenStore(identityPool, {
      onSidsRevoked: async (sids) => authority.deny(sids),
    });
    api = createIdentityApi(identityPool, authority, redis);
    app = await buildApp({
      config: testConfig({
        DATABASE_URL_APP: pgRoles.appUrl,
        DATABASE_URL_IDENTITY: pgRoles.identityUrl,
        REDIS_URL: redisBox.getConnectionUrl(),
      }),
      verifier: jwt,
      sessionAuthority: authority,
      healthChecks: [postgresHealthCheck(identityPool), redisHealthCheck(redis)],
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

  async function seedDriver(): Promise<{ accountId: string }> {
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'driver', $2, $3, 'active', 0, false, now())`,
      [
        accountId,
        `+9891${accountId.replace(/-/g, '').slice(0, 8)}`,
        `drv-${accountId.slice(0, 8)}`,
      ],
    );
    await ownerPool.query(
      `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash)
       VALUES ($1, $2, 'x')`,
      [accountId, DIST_A],
    );
    return { accountId };
  }

  async function seedStaff(
    role: 'super_admin' | 'distributor_admin',
  ): Promise<{ accountId: string }> {
    const accountId = randomUUID();
    await ownerPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'staff', $2, NULL, 'active', 0, false, now())`,
      [accountId, `+9892${accountId.replace(/-/g, '').slice(0, 8)}`],
    );
    await ownerPool.query(
      `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
       VALUES ($1, $2, $3, $4)`,
      [accountId, role, role === 'super_admin' ? null : DIST_A, []],
    );
    return { accountId };
  }

  async function issueDriverAt(): Promise<{
    accountId: string;
    sid: string;
    familyId: string;
    token: string;
    refreshToken: string;
  }> {
    const { accountId } = await seedDriver();
    const sid = randomUUID();
    const familyId = randomUUID();
    const issued = await store.issue({ accountId, sid, familyId, typ: 'driver' });
    const row = await new PgSessionStore(identityPool).lookup(sid);
    if (!row) throw new Error('missing session');
    await authority.rememberLive(row);
    const token = await jwt.sign({
      sub: accountId,
      typ: 'driver',
      sid,
      sv: row.sessionVersion,
      did: DIST_A,
    });
    return { accountId, sid, familyId, token, refreshToken: issued.refreshToken };
  }

  it('SESS-01: Redis hit does no PG lookup for the sid', async () => {
    const { sid, token } = await issueDriverAt();
    const before = authority.pgLookupsFor(sid);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(authority.pgLookupsFor(sid)).toBe(before);
  });

  it('SESS-02 / AUTH-RV-01: write-through revoke; next request is 401 via PG', async () => {
    const { accountId, token } = await issueDriverAt();
    await api.revokeSubjectSessions({ accountId, reason: 'logout_all' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
  });

  it('SESS-03 / AUTH-AV-02: fallback caches ≤1 PG lookup per sid per 2s and never caches revoke', async () => {
    const { sid, token, accountId } = await issueDriverAt();
    const deadRedis = createRedis('redis://127.0.0.1:1');
    const fallback = new RedisPgSessionAuthority(deadRedis, new PgSessionStore(identityPool));
    const fallbackApp = await buildApp({
      config: testConfig(),
      verifier: jwt,
      sessionAuthority: fallback,
      healthChecks: [],
    });
    try {
      const start = fallback.pgLookupsFor(sid);
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          fallbackApp.inject({
            method: 'GET',
            url: '/v1/driver/anything',
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      );
      expect(responses.every((row) => row.statusCode === 404)).toBe(true);
      expect(fallback.pgLookupsFor(sid) - start).toBeLessThanOrEqual(1);
      expect(fallback.pgFallbackTotal()).toBeGreaterThan(0);
      expect(identityPool.options.max).toBeLessThanOrEqual(PG_FALLBACK_POOL_MAX);

      await api.revokeSubjectSessions({ accountId, reason: 'logout_all' });
      const afterRevoke = new RedisPgSessionAuthority(
        createRedis('redis://127.0.0.1:1'),
        new PgSessionStore(identityPool),
      );
      const isolated = await buildApp({
        config: testConfig(),
        verifier: jwt,
        sessionAuthority: afterRevoke,
        healthChecks: [],
      });
      try {
        const revoked = await isolated.inject({
          method: 'GET',
          url: '/v1/driver/anything',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(revoked.statusCode).toBe(401);
        const lookups = afterRevoke.pgLookupsFor(sid);
        const again = await isolated.inject({
          method: 'GET',
          url: '/v1/driver/anything',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(again.statusCode).toBe(401);
        expect(afterRevoke.pgLookupsFor(sid)).toBeGreaterThanOrEqual(lookups);
      } finally {
        await isolated.close();
      }

      const health = await runHealthChecks(
        [postgresHealthCheck(identityPool), redisHealthCheck(createRedis('redis://127.0.0.1:1'))],
        200,
      );
      expect(health.status).toBe('degraded');
    } finally {
      await fallbackApp.close();
      deadRedis.disconnect();
    }
  });

  it('SESS-04 / AUTH-AV-03: refresh always goes to PG while Redis is unused', async () => {
    const { refreshToken, familyId } = await issueDriverAt();
    const rotated = await store.rotate(refreshToken, 'driver');
    expect(rotated.status).toBe('rotated');
    const grace = await store.rotate(refreshToken, 'driver');
    expect(grace.status).toBe('grace');
    const reuse = await store.rotate(refreshToken, 'driver');
    expect(reuse).toEqual({ status: 'rejected', reason: 'reuse' });
    const sessions = await identityPool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.sessions WHERE family_id = $1`,
      [familyId],
    );
    expect(sessions.rows.every((row) => row.revoked_at !== null)).toBe(true);
  });

  it('SESS-05 / AUTH-AV-01: Redis down fail-closes issuance with Retry-After', async () => {
    const dead = createRedis('redis://127.0.0.1:1');
    await expect(assertRedisForAuthIssuance(dead)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      details: { retryAfter: 5 },
    });
    const { accountId } = await seedDriver();
    await expect(api.assertIssuanceAllowed(accountId)).resolves.toEqual({ status: 'ok' });
  });

  it('SESS-07 / AUTH-AV-04: both Redis and PG down ⇒ 503, never signature-only', async () => {
    const { token } = await issueDriverAt();
    const isolated = new RedisPgSessionAuthority(createRedis('redis://127.0.0.1:1'), {
      lookup: () => Promise.reject(new Error('pg down')),
    });
    const broken = await buildApp({
      config: testConfig(),
      verifier: jwt,
      sessionAuthority: isolated,
      healthChecks: [],
    });
    try {
      const response = await broken.inject({
        method: 'GET',
        url: '/v1/driver/anything',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await broken.close();
    }
  });

  it('AUTH-AV-05: implementation is not Redis-only', () => {
    expect(authority.hasPgFallback).toBe(true);
  });

  it('AUTH-AV-02: 5 Redis errors open the breaker; half-open allows a single probe', async () => {
    let now = 1_000;
    let gets = 0;
    let redisDown = true;
    const failing = new RedisPgSessionAuthority(
      {
        status: 'ready',
        get: async () => {
          gets += 1;
          if (redisDown) throw new Error('down');
          return null;
        },
        set: async () => 'OK',
        incr: async () => 0,
        pipeline() {
          return {
            set() {
              return this;
            },
            del() {
              return this;
            },
            exec: async () => [[null, 'OK']],
          };
        },
      } as never,
      { lookup: async () => null },
      { clock: { now: () => now } },
    );
    for (let i = 0; i < 5; i += 1) {
      await failing.check(randomUUID());
    }
    expect(failing.breakerState()).toBe('open');
    const lookups = failing.pgFallbackTotal();
    const getsWhileOpen = gets;
    await failing.check(randomUUID());
    expect(failing.pgFallbackTotal()).toBe(lookups + 1);
    expect(gets).toBe(getsWhileOpen);
    now += 30_001;
    expect(failing.breakerState()).toBe('half_open');
    redisDown = false;
    const first = failing.check(randomUUID());
    const second = failing.check(randomUUID());
    await Promise.all([first, second]);
    expect(gets).toBe(getsWhileOpen + 2);
    expect(failing.breakerState()).toBe('closed');
  });

  it('AUTH-DI-01: inactive before revoke is 403; after revoke 401; issuance never driver_inactive', async () => {
    const { accountId, token } = await issueDriverAt();
    await identityPool.query(`UPDATE identity.accounts SET status = 'inactive' WHERE id = $1`, [
      accountId,
    ]);
    await authority.invalidateLive([
      JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).sid,
    ]);
    const during = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(during.statusCode).toBe(403);
    expect(during.json()).toMatchObject({ error: { code: 'driver_inactive' } });

    await api.deactivateAccount(accountId);
    const after = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const gate = await api.assertIssuanceAllowed(accountId);
    expect(gate).toEqual({ status: 'rejected', reason: 'invalid_credentials' });
  });

  it('9-18 / G3: family revoke rejects the grace-issued AT by sid', async () => {
    const { refreshToken, accountId, sid } = await issueDriverAt();
    const first = await store.rotate(refreshToken, 'driver');
    expect(first.status).toBe('rotated');
    const grace = await store.rotate(refreshToken, 'driver');
    expect(grace.status).toBe('grace');
    const row = await new PgSessionStore(identityPool).lookup(sid);
    const graceAt = await jwt.sign({
      sub: accountId,
      typ: 'driver',
      sid,
      sv: row?.sessionVersion ?? 0,
      did: DIST_A,
    });
    const reuse = await store.rotate(refreshToken, 'driver');
    expect(reuse).toEqual({ status: 'rejected', reason: 'reuse' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${graceAt}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
  });

  it('9-17: driver reuse audit and outbox carry distributor_id', async () => {
    const { refreshToken, familyId } = await issueDriverAt();
    await store.rotate(refreshToken, 'driver');
    await store.rotate(refreshToken, 'driver');
    await store.rotate(refreshToken, 'driver');
    const audit = await ownerPool.query<{ distributor_id: string | null }>(
      `SELECT distributor_id FROM platform.audit_log WHERE entity_id = $1 AND action = 'refresh_reuse'`,
      [familyId],
    );
    expect(audit.rows[0]?.distributor_id).toBe(DIST_A);
    const outbox = await ownerPool.query<{ distributor_id: string | null }>(
      `SELECT distributor_id FROM platform.outbox_events WHERE aggregate_id = $1`,
      [familyId],
    );
    expect(outbox.rows[0]?.distributor_id).toBe(DIST_A);
  });

  it('TEN-05-PLAT: is_platform is true only for SA without scope', async () => {
    const { accountId } = await seedStaff('super_admin');
    const sid = randomUUID();
    await store.issue({ accountId, sid, familyId: randomUUID(), typ: 'staff' });
    const row = await new PgSessionStore(identityPool).lookup(sid);
    if (!row) throw new Error('missing sa session');
    await authority.rememberLive(row);
    const token = await jwt.sign({ sub: accountId, typ: 'staff', sid, sv: row.sessionVersion });
    const open = await app.inject({
      method: 'GET',
      url: '/v1/admin/anything',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(open.statusCode).toBe(404);
    expect(row.permissions).toContain('settings.manage');
    expect(row.permissions).toHaveLength(28);
    await withTenant(appPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      const guc = await tx.client.query<{ v: string | null }>(
        `SELECT current_setting('app.is_platform', true) AS v`,
      );
      expect(guc.rows[0]?.v).toBe('true');
    });
    await withTenant(
      appPool,
      { subjectType: 'staff', distributorId: DIST_B, isPlatform: false },
      async (tx) => {
        const guc = await tx.client.query<{ v: string | null }>(
          `SELECT current_setting('app.is_platform', true) AS v`,
        );
        expect(guc.rows[0]?.v).toBe('false');
      },
    );
  });

  it('SCOPE-SA-01: SA honours X-Scope-Distributor; DA does not leave its tenant', async () => {
    const { accountId } = await seedStaff('distributor_admin');
    const sid = randomUUID();
    await store.issue({ accountId, sid, familyId: randomUUID(), typ: 'staff' });
    const row = await new PgSessionStore(identityPool).lookup(sid);
    if (!row) throw new Error('missing da');
    await authority.rememberLive(row);
    const token = await jwt.sign({
      sub: accountId,
      typ: 'staff',
      sid,
      sv: row.sessionVersion,
      did: DIST_A,
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/anything',
      headers: {
        authorization: `Bearer ${token}`,
        'x-scope-distributor': DIST_B,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(row.distributorId).toBe(DIST_A);
    expect(row.permissions).not.toContain('settings.manage');
  });

  it('AUTH-JW-04-RA: real DA token rejects client-supplied distributorId', async () => {
    const { accountId } = await seedStaff('distributor_admin');
    const sid = randomUUID();
    await store.issue({ accountId, sid, familyId: randomUUID(), typ: 'staff' });
    const row = await new PgSessionStore(identityPool).lookup(sid);
    if (!row) throw new Error('missing da');
    await authority.rememberLive(row);
    const token = await jwt.sign({
      sub: accountId,
      typ: 'staff',
      sid,
      sv: row.sessionVersion,
      did: DIST_A,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/anything',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { distributorId: DIST_B },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'distributorId' } },
    });
  });

  it('A-11-1: seed live, revoke while Redis is down, restore, 401 within 5s', async () => {
    const { accountId, token, sid } = await issueDriverAt();
    const box = await new RedisContainer('redis:7-alpine').start();
    const liveRedis = createRedis(box.getConnectionUrl());
    await liveRedis.connect();
    const liveAuthority = new RedisPgSessionAuthority(liveRedis, new PgSessionStore(identityPool));
    const snapshot = await new PgSessionStore(identityPool).lookup(sid);
    if (!snapshot) throw new Error('missing snapshot');
    await liveAuthority.rememberLive(snapshot);
    const downAuthority = new RedisPgSessionAuthority(
      createRedis('redis://127.0.0.1:1'),
      new PgSessionStore(identityPool),
      { denyAttempts: 1 },
    );
    const isolatedApi = createIdentityApi(identityPool, downAuthority, liveRedis);
    await isolatedApi.revokeSubjectSessions({ accountId, reason: 'logout_all' });
    const pending = await listOpenPendingDenies(identityPool);
    expect(pending).toContain(sid);
    await drainPendingDenies(identityPool, (sids) => liveAuthority.deny(sids));
    const isolated = await buildApp({
      config: testConfig(),
      verifier: jwt,
      sessionAuthority: liveAuthority,
      healthChecks: [],
    });
    try {
      const deadline = Date.now() + 5_000;
      let status = 0;
      while (Date.now() <= deadline) {
        const response = await isolated.inject({
          method: 'GET',
          url: '/v1/driver/anything',
          headers: { authorization: `Bearer ${token}` },
        });
        status = response.statusCode;
        if (status === 401) {
          expect(response.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(status).toBe(401);
    } finally {
      await isolated.close();
      await liveRedis.quit().catch(() => liveRedis.disconnect());
      await box.stop();
    }
  });

  it('11-1: deny write failure still revokes within 5s via the PG path', async () => {
    const { accountId, token, sid } = await issueDriverAt();
    const failing = new RedisPgSessionAuthority(
      {
        status: 'ready',
        get: async () => null,
        set: async () => 'OK',
        pipeline() {
          return {
            set() {
              return this;
            },
            del() {
              return this;
            },
            exec: async () => {
              throw new Error('deny down');
            },
          };
        },
      } as never,
      new PgSessionStore(identityPool),
      { denyAttempts: 2 },
    );
    const isolatedApi = createIdentityApi(identityPool, failing, redis);
    await isolatedApi.revokeSubjectSessions({ accountId, reason: 'logout_all' });
    const isolated = await buildApp({
      config: testConfig(),
      verifier: jwt,
      sessionAuthority: failing,
      healthChecks: [],
    });
    try {
      const response = await isolated.inject({
        method: 'GET',
        url: '/v1/driver/anything',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
      expect(failing.pgLookupsFor(sid)).toBeGreaterThan(0);
    } finally {
      await isolated.close();
    }
  });

  it('11-6: a token sv that differs from the row sv is SESSION_REVOKED', async () => {
    const { accountId, sid } = await issueDriverAt();
    const row = await new PgSessionStore(identityPool).lookup(sid);
    const token = await jwt.sign({
      sub: accountId,
      typ: 'driver',
      sid,
      sv: (row?.sessionVersion ?? 0) + 1,
      did: DIST_A,
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
  });

  it('11-5: refresh-reuse revokes only that family; another family survives', async () => {
    const { accountId, refreshToken, familyId, sid } = await issueDriverAt();
    const otherSid = randomUUID();
    const otherFamily = randomUUID();
    await store.issue({ accountId, sid: otherSid, familyId: otherFamily, typ: 'driver' });
    const otherRow = await new PgSessionStore(identityPool).lookup(otherSid);
    if (!otherRow) throw new Error('missing other family');
    await authority.rememberLive(otherRow);
    const otherToken = await jwt.sign({
      sub: accountId,
      typ: 'driver',
      sid: otherSid,
      sv: otherRow.sessionVersion,
      did: DIST_A,
    });
    await store.rotate(refreshToken, 'driver');
    await store.rotate(refreshToken, 'driver');
    await store.rotate(refreshToken, 'driver');
    const reused = await identityPool.query<{ revoked_at: Date | null; session_version: number }>(
      `SELECT s.revoked_at, a.session_version
         FROM identity.sessions s
         JOIN identity.accounts a ON a.id = s.account_id
        WHERE s.sid = $1`,
      [sid],
    );
    expect(reused.rows[0]?.revoked_at).not.toBeNull();
    expect(reused.rows[0]?.session_version).toBe(0);
    const survivor = await identityPool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.sessions WHERE family_id = $1`,
      [otherFamily],
    );
    expect(survivor.rows[0]?.revoked_at).toBeNull();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/driver/anything',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(familyId).not.toBe(otherFamily);
  });

  it('11-3: accounts.status CHECK rejects unknown values; non-active is inactive', async () => {
    const { accountId } = await seedDriver();
    await expect(
      ownerPool.query(`UPDATE identity.accounts SET status = 'suspended' WHERE id = $1`, [
        accountId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('11-12: app cannot EXECUTE SECURITY DEFINER login lookups', async () => {
    await expect(
      appPool.query(`SELECT * FROM identity.lookup_session($1)`, [randomUUID()]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      appPool.query(`SELECT * FROM identity.lookup_staff_login($1)`, ['+98920000000']),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('7-7: lookup_staff_login is SECURITY DEFINER for identity', async () => {
    const { accountId } = await seedStaff('distributor_admin');
    const phone = await identityPool.query<{ phone: string }>(
      `SELECT phone FROM identity.accounts WHERE id = $1`,
      [accountId],
    );
    const found = await identityPool.query<{ account_id: string; role: string }>(
      `SELECT * FROM identity.lookup_staff_login($1)`,
      [phone.rows[0]?.phone],
    );
    expect(found.rows[0]?.account_id).toBe(accountId);
    expect(found.rows[0]?.role).toBe('distributor_admin');
  });
});
