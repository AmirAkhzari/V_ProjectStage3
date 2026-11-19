import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const DIST_1 = '02000000-0000-4000-8000-000000000001';
const DIST_2 = '02000000-0000-4000-8000-000000000002';
const DIST_3 = '02000000-0000-4000-8000-000000000003';

interface Principal {
  sid: string;
  role: 'distributor_admin' | 'super_admin';
  distributorId: string | null;
  permissions: readonly string[];
}

const PRINCIPALS = new Map<string, Principal>([
  [
    'da1-view',
    {
      sid: 'sid-da1-view',
      role: 'distributor_admin',
      distributorId: DIST_1,
      permissions: ['distributors.view'],
    },
  ],
  [
    'da1-manage',
    {
      sid: 'sid-da1-manage',
      role: 'distributor_admin',
      distributorId: DIST_1,
      permissions: ['distributors.manage'],
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
    const principal = PRINCIPALS.get(token);
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

describe('B24 tenant list', () => {
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
              ($2, 'Distributor 2', 'paused', now()),
              ($3, 'Alpha Distribution', 'active', now())`,
      [DIST_1, DIST_2, DIST_3],
    );
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
      appDb: appPool,
    });
  }, 120_000);

  beforeEach(async () => {
    await ownerPool.query(
      `UPDATE tenancy.distributors SET name = 'Distributor 1', status = 'active' WHERE id = $1`,
      [DIST_1],
    );
    await ownerPool.query(
      `UPDATE tenancy.distributors SET name = 'Distributor 2', status = 'paused' WHERE id = $1`,
      [DIST_2],
    );
    await ownerPool.query(
      `UPDATE tenancy.distributors SET name = 'Alpha Distribution', status = 'active' WHERE id = $1`,
      [DIST_3],
    );
  });

  afterAll(async () => {
    await app?.close();
    await appPool?.end();
    await ownerPool?.end();
    await pgRoles?.postgres.stop();
  });

  const list = (token: string, query = '', headers: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: `/v1/admin/distributors${query}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  it('lists only the caller tenant through RLS', async () => {
    const response = await list('da1-view');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      items: [
        { id: DIST_1, name: 'Distributor 1', status: 'active', createdAt: expect.any(String) },
      ],
    });
  });

  it('shows every tenant to the platform scope, ordered by name', async () => {
    const response = await list('sa', '?all=1');
    expect(response.statusCode, response.body).toBe(200);
    const ids = (response.json() as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).toEqual([DIST_3, DIST_1, DIST_2]);
  });

  it('narrows a scoped super admin back to the declared tenant', async () => {
    const scoped = await list('sa', '', { 'x-scope-distributor': DIST_1 });
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(scoped.json()).toEqual({
      items: [
        { id: DIST_1, name: 'Distributor 1', status: 'active', createdAt: expect.any(String) },
      ],
    });

    // The switcher flag never escapes the scope the caller asked for.
    const escaped = await list('sa', '?all=1', { 'x-scope-distributor': DIST_1 });
    expect(escaped.statusCode).toBe(403);
    expect(escaped.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('refuses all=1 for a tenant-scoped distributor admin instead of widening it', async () => {
    const response = await list('da1-view', '?all=1');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('requires distributors.view, not distributors.manage', async () => {
    const denied = await list('da1-manage');
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('accepts only the exact all=1 value', async () => {
    for (const query of ['?all=0', '?all=true', '?all=', '?all=1&all=1']) {
      const response = await list('sa', query);
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('answers 401 without a staff bearer', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/distributors' });
    expect(response.statusCode).toBe(401);
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
        url: '/v1/admin/distributors',
        headers: { authorization: 'Bearer da1-view' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await noDb.close();
    }
  });
});
