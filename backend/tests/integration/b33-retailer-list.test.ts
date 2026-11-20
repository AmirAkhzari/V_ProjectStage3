/**
 * B33 (`GET /v1/admin/retailers`) and its B34 sibling (`GET /v1/admin/retailers/{id}`). Both read
 * the same rows through the same RLS policy on the same seeded harness, so the B34 cases live in
 * this file rather than paying for a second copy of the auth and session setup.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { SUPER_ADMIN_PERMISSIONS } from '../../src/modules/identity/domain/permissions.js';
import {
  encodeRetailerCursor,
  type RetailerView,
} from '../../src/modules/customers/application/listRetailers.js';
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

const SHOP_A = '01000000-0000-4000-8000-00000000000a';
const SHOP_B = '01000000-0000-4000-8000-00000000000b';
const SHOP_C = '01000000-0000-4000-8000-00000000000c';
const SHOP_D = '01000000-0000-4000-8000-00000000000d';

// `shopkeepers.account_id` is a uuid column, not an opaque string.
const ACC_A = '03000000-0000-4000-8000-00000000000a';
const ACC_B = '03000000-0000-4000-8000-00000000000b';
const ACC_C = '03000000-0000-4000-8000-00000000000c';
const ACC_D = '03000000-0000-4000-8000-00000000000d';

const A_AT = '2026-11-19T10:00:00.000Z';
const B_AT = '2026-11-19T09:00:00.000Z';
const C_AT = '2026-11-19T11:00:00.000Z';
const D_AT = '2026-11-19T12:00:00.000Z';

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
      permissions: ['retailers.view'],
    },
  ],
  [
    'da1-manage',
    {
      sid: 'sid-da1-manage',
      role: 'distributor_admin',
      distributorId: DIST_1,
      permissions: ['retailers.manage'],
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

interface Page {
  items: RetailerView[];
  hasMore: boolean;
  nextAfter: string | null;
}

describe('B33/B34 retailers', () => {
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
    // `on conflict` keeps an external Postgres (`TEST_PG_ADMIN_URL`) usable across runs.
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'Distributor 1', 'active', now()),
              ($2, 'Distributor 2', 'active', now())
       ON CONFLICT (id) DO NOTHING`,
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

  beforeEach(async () => {
    await ownerPool.query('DELETE FROM customers.shopkeepers');
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, primary_distributor_id, status, created_at)
       VALUES ($1, $5, '09120000001', $3, 'active', $7),
              ($2, $6, '09120000002', $3, 'blocked', $8),
              ($4, $9, '09120000003', $10, 'active', $11),
              ($12, $13, '09120000004', NULL, 'active', $14)`,
      [SHOP_A, SHOP_B, DIST_1, SHOP_C, ACC_A, ACC_B, A_AT, B_AT, ACC_C, DIST_2, C_AT, SHOP_D, ACC_D, D_AT],
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
      url: `/v1/admin/retailers${query}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  it('shows a distributor admin only its own shops, newest first', async () => {
    const response = await list('da1-view');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as Page;
    expect(body.items.map((item) => item.id)).toEqual([SHOP_A, SHOP_B]);
    expect(body.items[0]).toEqual({
      id: SHOP_A,
      phone: '09120000001',
      status: 'active',
      primaryDistributorId: DIST_1,
      primaryDistributorName: 'Distributor 1',
      createdAt: A_AT,
    });
    expect(body.hasMore).toBe(false);
    expect(body.nextAfter).toBeNull();
  });

  it('shows every shop to the platform scope and narrows a scoped super admin', async () => {
    const all = await list('sa');
    expect(all.statusCode, all.body).toBe(200);
    expect((all.json() as Page).items.map((item) => item.id)).toEqual([
      SHOP_D,
      SHOP_C,
      SHOP_A,
      SHOP_B,
    ]);

    const scoped = await list('sa', '', { 'x-scope-distributor': DIST_1 });
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect((scoped.json() as Page).items.map((item) => item.id)).toEqual([SHOP_A, SHOP_B]);
  });

  it('honours a smaller page size and resumes exactly after the cursor', async () => {
    const first = await list('sa', '?limit=2');
    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json() as Page;
    expect(firstBody.items.map((item) => item.id)).toEqual([SHOP_D, SHOP_C]);
    expect(firstBody.hasMore).toBe(true);
    // The cursor resumes after the last row of the page, which is SHOP_C (11:00), not SHOP_D.
    expect(firstBody.nextAfter).toBe(encodeRetailerCursor(C_AT, SHOP_C));

    const second = await list('sa', `?limit=2&after=${firstBody.nextAfter}`);
    expect(second.statusCode, second.body).toBe(200);
    const secondBody = second.json() as Page;
    expect(secondBody.items.map((item) => item.id)).toEqual([SHOP_A, SHOP_B]);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextAfter).toBeNull();
  });

  it('resumes on (created_at, id), so equal timestamps never skip or repeat a row', async () => {
    const sameAt = '2026-11-19T08:00:00.000Z';
    await ownerPool.query(
      `UPDATE customers.shopkeepers SET created_at = $1 WHERE id = ANY($2::uuid[])`,
      [sameAt, [SHOP_A, SHOP_B]],
    );
    const first = await list('da1-view', '?limit=1');
    const firstBody = first.json() as Page;
    expect(firstBody.items.map((item) => item.id)).toEqual([SHOP_B]);
    expect(firstBody.nextAfter).toBe(encodeRetailerCursor(sameAt, SHOP_B));

    const second = await list('da1-view', `?limit=1&after=${firstBody.nextAfter}`);
    const secondBody = second.json() as Page;
    expect(secondBody.items.map((item) => item.id)).toEqual([SHOP_A]);
    expect(secondBody.hasMore).toBe(false);
  });

  it('narrows by status and phone fragment on the server, before it pages', async () => {
    const blocked = await list('sa', '?status=blocked');
    expect(blocked.statusCode, blocked.body).toBe(200);
    expect((blocked.json() as Page).items.map((item) => item.id)).toEqual([SHOP_B]);

    const fragment = await list('sa', '?q=0003');
    expect(fragment.statusCode, fragment.body).toBe(200);
    expect((fragment.json() as Page).items.map((item) => item.id)).toEqual([SHOP_C]);

    const both = await list('da1-view', '?status=active&q=09120000001');
    expect(both.statusCode, both.body).toBe(200);
    expect((both.json() as Page).items.map((item) => item.id)).toEqual([SHOP_A]);

    // A filter must not be limited to the first page: the cursor resumes inside the filtered set.
    const first = (await list('sa', '?status=active&limit=2')).json() as Page;
    expect(first.items.map((item) => item.id)).toEqual([SHOP_D, SHOP_C]);
    const next = (await list('sa', `?status=active&limit=2&after=${first.nextAfter}`)).json() as Page;
    expect(next.items.map((item) => item.id)).toEqual([SHOP_A]);
  });

  it('rejects a filter the phone column or the status set cannot express', async () => {
    for (const query of ['?q=abc', '?q=', '?status=deleted']) {
      const response = await list('sa', query);
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('rejects a malformed page request instead of guessing at a page', async () => {
    for (const query of ['?limit=0', '?limit=501', '?limit=01', '?after=', '?after=*']) {
      const response = await list('sa', query);
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('requires retailers.view, not retailers.manage', async () => {
    const denied = await list('da1-manage');
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('answers 401 without a staff bearer', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/retailers' });
    expect(response.statusCode).toBe(401);
  });

  const detail = (token: string, id: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: `/v1/admin/retailers/${id}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  it('B34: reads one shop of the caller tenant with the same view as the list', async () => {
    const response = await detail('da1-view', SHOP_B);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      id: SHOP_B,
      phone: '09120000002',
      status: 'blocked',
      primaryDistributorId: DIST_1,
      primaryDistributorName: 'Distributor 1',
      createdAt: B_AT,
    });
  });

  it('B34: a foreign, unknown or malformed id is the same 404', async () => {
    const foreign = await detail('da1-view', SHOP_C);
    const unknown = await detail('da1-view', '09000000-0000-4000-8000-000000000000');
    const malformed = await detail('da1-view', 'not-a-uuid');
    for (const response of [foreign, unknown, malformed]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(foreign.body).toBe(unknown.body);
    expect(foreign.body).toBe(malformed.body);
    // A shop nobody supplies is invisible to a tenant, and visible only through the platform scope.
    expect((await detail('da1-view', SHOP_D)).statusCode).toBe(404);
    expect((await detail('sa', SHOP_D)).statusCode).toBe(200);
  });

  it('B34: the platform scope reads any id and a scope header narrows it back', async () => {
    expect((await detail('sa', SHOP_C)).statusCode).toBe(200);
    const scoped = await detail('sa', SHOP_C, { 'x-scope-distributor': DIST_1 });
    expect(scoped.statusCode).toBe(404);
    expect((await detail('sa', SHOP_A, { 'x-scope-distributor': DIST_1 })).statusCode).toBe(200);
  });

  it('B34: requires retailers.view, a staff bearer and a wired pool', async () => {
    const denied = await detail('da1-manage', SHOP_A);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const anonymous = await app.inject({ method: 'GET', url: `/v1/admin/retailers/${SHOP_A}` });
    expect(anonymous.statusCode).toBe(401);

    const noDb = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
    });
    try {
      const response = await noDb.inject({
        method: 'GET',
        url: `/v1/admin/retailers/${SHOP_A}`,
        headers: { authorization: 'Bearer da1-view' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await noDb.close();
    }
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
        url: '/v1/admin/retailers',
        headers: { authorization: 'Bearer da1-view' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await noDb.close();
    }
  });
});
