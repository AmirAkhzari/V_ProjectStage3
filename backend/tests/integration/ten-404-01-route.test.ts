import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { SUPER_ADMIN_PERMISSIONS } from '../../src/modules/identity/domain/permissions.js';
import type { AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type {
  SessionAuthority,
  SessionSnapshot,
} from '../../src/platform/auth/sessionAuthority.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST_1 = '01000000-0000-4000-8000-000000000001';
const DIST_2 = '01000000-0000-4000-8000-000000000002';
const DIST_ABSENT = '01000000-0000-4000-8000-0000000000ff';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };

interface Principal {
  sid: string;
  role: 'distributor_admin' | 'super_admin';
  distributorId: string | null;
  permissions: readonly string[];
}

/** Tenants are selected by the bearer token, so one app serves every principal. */
const PRINCIPALS = new Map<string, Principal>([
  [
    'da1-view',
    {
      sid: 'sid-da1',
      role: 'distributor_admin',
      distributorId: DIST_1,
      permissions: ['distributors.view'],
    },
  ],
  [
    'da1-noperm',
    { sid: 'sid-da1-noperm', role: 'distributor_admin', distributorId: DIST_1, permissions: [] },
  ],
  [
    'da2-view',
    {
      sid: 'sid-da2',
      role: 'distributor_admin',
      distributorId: DIST_2,
      permissions: ['distributors.view'],
    },
  ],
  [
    'sa',
    {
      sid: 'sid-sa',
      role: 'super_admin',
      distributorId: null,
      permissions: SUPER_ADMIN_PERMISSIONS,
    },
  ],
]);

function principalOf(token: string): Principal | undefined {
  return PRINCIPALS.get(token);
}

function snapshotOf(principal: Principal): SessionSnapshot {
  return {
    sid: principal.sid,
    accountId: `staff-${principal.sid}`,
    typ: 'staff',
    familyId: `family-${principal.sid}`,
    sessionVersion: 0,
    accountStatus: 'active',
    revokedAt: null,
    distributorId: principal.distributorId,
    staffRole: principal.role,
    permissions: principal.permissions,
    mustChangePassword: false,
  };
}

const verifier: AccessTokenVerifier = {
  verify: (token) => {
    const principal = principalOf(token);
    if (!principal) return Promise.reject(new Error('unknown token'));
    return Promise.resolve({
      sub: `staff-${principal.sid}`,
      typ: 'staff',
      sid: principal.sid,
      sv: 0,
    });
  },
};

const authority: SessionAuthority = {
  hasPgFallback: true,
  check: (sid) => {
    for (const principal of PRINCIPALS.values()) {
      if (principal.sid === sid) {
        return Promise.resolve({ status: 'active', row: snapshotOf(principal) });
      }
    }
    return Promise.resolve({ status: 'revoked', reason: 'missing' });
  },
  rememberLive: () => Promise.resolve(),
  deny: () => Promise.resolve(),
  invalidateLive: () => Promise.resolve(),
  breakerState: () => 'closed',
  pgFallbackTotal: () => 0,
  pgLookupsFor: () => 0,
};

function withoutRequestId(headers: Record<string, unknown>): Record<string, unknown> {
  const { 'x-request-id': _requestId, ...rest } = headers;
  return rest;
}

describe('TEN-404-01 tenant-scoped 404 uniformity (B25)', () => {
  let pgRoles: StartedPostgresRoles;
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let app: App;

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    appPool = new pg.Pool({ connectionString: pgRoles.appUrl, max: 4 });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl, max: 2 });
    attachPgTeardownGuard(appPool);
    attachPgTeardownGuard(ownerPool);
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'Distributor 1', 'active', now()),
              ($2, 'Distributor 2', 'active', now())`,
      [DIST_1, DIST_2],
    );
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
      appDb: appPool,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await appPool?.end();
    await ownerPool?.end();
    await pgRoles?.postgres.stop();
  });

  const get = (token: string, id: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: `/v1/admin/distributors/${id}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  const expectSameNotFound = (
    response: Awaited<ReturnType<typeof app.inject>>,
    missing: Awaited<ReturnType<typeof app.inject>>,
  ) => {
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    expect(response.body).toBe(missing.body);
    expect(response.json()).toEqual(NOT_FOUND);
    expect(withoutRequestId(response.headers)).toEqual(withoutRequestId(missing.headers));
  };

  it('serves the distributor inside the caller tenant', async () => {
    const own = await get('da1-view', DIST_1);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toEqual({
      id: DIST_1,
      name: 'Distributor 1',
      status: 'active',
      createdAt: expect.any(String),
    });
  });

  it('makes a foreign tenant byte-identical to a genuinely missing resource', async () => {
    expectSameNotFound(await get('da1-view', DIST_2), await get('da1-view', DIST_ABSENT));
  });

  it('keeps the other tenant out even though the row exists', async () => {
    expectSameNotFound(await get('da2-view', DIST_1), await get('da2-view', randomUUID()));
    const own = await get('da2-view', DIST_2);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ id: DIST_2, name: 'Distributor 2' });
  });

  it('lets an unscoped super admin read any tenant and scopes the header when present', async () => {
    const platform = await get('sa', DIST_2);
    expect(platform.statusCode, platform.body).toBe(200);
    expect(platform.json()).toMatchObject({ id: DIST_2 });

    const scopedOwn = await get('sa', DIST_1, { 'x-scope-distributor': DIST_1 });
    expect(scopedOwn.statusCode, scopedOwn.body).toBe(200);

    expectSameNotFound(
      await get('sa', DIST_2, { 'x-scope-distributor': DIST_1 }),
      await get('sa', DIST_ABSENT, { 'x-scope-distributor': DIST_1 }),
    );
  });

  it('answers a malformed id with the same NOT_FOUND envelope', async () => {
    const malformed = await get('da1-view', 'not-a-uuid');
    expect(malformed.statusCode).toBe(404);
    expect(malformed.body).toBe((await get('da1-view', DIST_ABSENT)).body);
  });

  it('requires distributors.view', async () => {
    const denied = await get('da1-noperm', DIST_1);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('requires authentication', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/admin/distributors/${DIST_1}`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('fails closed with 503 when no app-role pool is wired', async () => {
    const noDb = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
    });
    try {
      const response = await noDb.inject({
        method: 'GET',
        url: `/v1/admin/distributors/${DIST_1}`,
        headers: { authorization: 'Bearer da1-view' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await noDb.close();
    }
  });
});
