/**
 * B33 (`GET /v1/admin/retailers`) and its siblings B34 (`GET /{id}`), B35 (`PATCH /{id}`) and B36
 * (`PUT /{id}/primary-distributor`). They all read or write the same rows through the same RLS policy
 * on the same seeded harness, so the sibling cases live in this file rather than paying for a second
 * copy of the auth and session setup.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { withTenant } from '../../src/platform/db/tenant.js';
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
      [
        SHOP_A,
        SHOP_B,
        DIST_1,
        SHOP_C,
        ACC_A,
        ACC_B,
        A_AT,
        B_AT,
        ACC_C,
        DIST_2,
        C_AT,
        SHOP_D,
        ACC_D,
        D_AT,
      ],
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
    const next = (
      await list('sa', `?status=active&limit=2&after=${first.nextAfter}`)
    ).json() as Page;
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

  const patchStatus = (
    token: string,
    id: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/admin/retailers/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      payload: body as object,
    });

  const statusAudits = async (id: string) => {
    const result = await ownerPool.query<{
      data: { retailerId: string; statusBefore: string; statusAfter: string };
    }>(
      `SELECT data FROM platform.audit_log
        WHERE action = 'retailer_status_updated' AND entity_id = $1`,
      [id],
    );
    return result.rows;
  };

  it('B35: blocks a shop of the caller tenant and audits before/after', async () => {
    const response = await patchStatus('da1-manage', SHOP_A, { status: 'blocked' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: SHOP_A, status: 'blocked', phone: '09120000001' });

    const stored = await ownerPool.query<{ status: string; phone: string }>(
      `SELECT status, phone FROM customers.shopkeepers WHERE id = $1`,
      [SHOP_A],
    );
    expect(stored.rows[0]).toEqual({ status: 'blocked', phone: '09120000001' });

    const audits = await statusAudits(SHOP_A);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.data).toMatchObject({
      retailerId: SHOP_A,
      statusBefore: 'active',
      statusAfter: 'blocked',
    });
  });

  it('B35: the same status is a 200 no-op with no second audit row', async () => {
    expect((await patchStatus('da1-manage', SHOP_A, { status: 'active' })).statusCode).toBe(200);
    const before = (await statusAudits(SHOP_A)).length;

    const again = await patchStatus('da1-manage', SHOP_A, { status: 'active' });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ id: SHOP_A, status: 'active' });
    expect(await statusAudits(SHOP_A)).toHaveLength(before);
  });

  it('B35: a foreign, unknown or malformed id is the same 404 and changes nothing', async () => {
    const before = await statusAudits(SHOP_C);
    const foreign = await patchStatus('da1-manage', SHOP_C, { status: 'blocked' });
    const unknown = await patchStatus('da1-manage', '09000000-0000-4000-8000-000000000000', {
      status: 'blocked',
    });
    const malformed = await patchStatus('da1-manage', 'not-a-uuid', { status: 'blocked' });
    for (const response of [foreign, unknown, malformed]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(foreign.body).toBe(unknown.body);
    expect(foreign.body).toBe(malformed.body);

    const stored = await ownerPool.query<{ status: string }>(
      `SELECT status FROM customers.shopkeepers WHERE id = $1`,
      [SHOP_C],
    );
    expect(stored.rows[0]?.status).toBe('active');
    expect(await statusAudits(SHOP_C)).toHaveLength(before.length);
  });

  it('B35: the platform scope changes any shop and a scope header narrows it', async () => {
    expect((await patchStatus('sa', SHOP_C, { status: 'blocked' })).statusCode).toBe(200);
    expect((await patchStatus('sa', SHOP_B, { status: 'active' })).statusCode).toBe(200);

    const scoped = await patchStatus(
      'sa',
      SHOP_C,
      { status: 'active' },
      { 'x-scope-distributor': DIST_1 },
    );
    expect(scoped.statusCode).toBe(404);
  });

  it('B35: requires retailers.manage, a staff bearer, a strict body and a pool', async () => {
    const denied = await patchStatus('da1-view', SHOP_A, { status: 'blocked' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const anonymous = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/retailers/${SHOP_A}`,
      payload: { status: 'blocked' },
    });
    expect(anonymous.statusCode).toBe(401);

    for (const body of [{ status: 'deleted' }, {}, { status: 'active', extra: 1 }, { status: 1 }]) {
      const response = await patchStatus('da1-manage', SHOP_A, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }

    const noDb = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
    });
    try {
      const response = await noDb.inject({
        method: 'PATCH',
        url: `/v1/admin/retailers/${SHOP_A}`,
        headers: { authorization: 'Bearer da1-manage', 'content-type': 'application/json' },
        payload: { status: 'blocked' },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await noDb.close();
    }
  });

  it('B35: the app role may write only the status column', async () => {
    const tenant = { subjectType: 'staff', distributorId: DIST_1 } as const;
    // The denied statement aborts its transaction, so each probe takes its own.
    await expect(
      withTenant(appPool, tenant, async (tx) => {
        await tx.client.query(`UPDATE customers.shopkeepers SET phone = phone WHERE id = $1`, [
          SHOP_A,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
    await withTenant(appPool, tenant, async (tx) => {
      const foreign = await tx.client.query(
        `UPDATE customers.shopkeepers SET status = 'blocked' WHERE id = $1`,
        [SHOP_C],
      );
      expect(foreign.rowCount).toBe(0);
    });
  });

  const putDistributor = (
    token: string,
    id: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'PUT',
      url: `/v1/admin/retailers/${id}/primary-distributor`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      payload: body as object,
    });

  const distributorAudits = async (id: string) => {
    const result = await ownerPool.query<{
      data: {
        retailerId: string;
        distributorBefore: string | null;
        distributorAfter: string | null;
      };
    }>(
      `SELECT data FROM platform.audit_log
        WHERE action = 'retailer_primary_distributor_changed' AND entity_id = $1`,
      [id],
    );
    return result.rows;
  };

  const storedDistributor = async (id: string) => {
    const result = await ownerPool.query<{ primary_distributor_id: string | null }>(
      `SELECT primary_distributor_id FROM customers.shopkeepers WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.primary_distributor_id ?? null;
  };

  it('B36: the platform scope moves a shop to another distributor and audits before/after', async () => {
    const before = (await distributorAudits(SHOP_C)).length;
    const response = await putDistributor('sa', SHOP_C, { primaryDistributorId: DIST_1 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: SHOP_C,
      primaryDistributorId: DIST_1,
      primaryDistributorName: 'Distributor 1',
    });
    expect(await storedDistributor(SHOP_C)).toBe(DIST_1);

    const audits = await distributorAudits(SHOP_C);
    expect(audits).toHaveLength(before + 1);
    expect(audits[0]?.data).toMatchObject({
      retailerId: SHOP_C,
      distributorBefore: DIST_2,
      distributorAfter: DIST_1,
    });
  });

  it('B36: the distributor a shop already has is a 200 no-op with no audit row', async () => {
    const before = (await distributorAudits(SHOP_A)).length;
    const response = await putDistributor('da1-manage', SHOP_A, { primaryDistributorId: DIST_1 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: SHOP_A, primaryDistributorId: DIST_1 });
    expect(await distributorAudits(SHOP_A)).toHaveLength(before);
  });

  it('B36: a distributor the caller cannot see is a 404 and changes nothing', async () => {
    const before = (await distributorAudits(SHOP_A)).length;
    const response = await putDistributor('da1-manage', SHOP_A, { primaryDistributorId: DIST_2 });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await storedDistributor(SHOP_A)).toBe(DIST_1);
    expect(await distributorAudits(SHOP_A)).toHaveLength(before);
  });

  it('B36: a foreign, unknown or malformed shop id is the same 404', async () => {
    const foreign = await putDistributor('da1-manage', SHOP_C, { primaryDistributorId: DIST_1 });
    const unknown = await putDistributor('da1-manage', '09000000-0000-4000-8000-000000000000', {
      primaryDistributorId: DIST_1,
    });
    const malformed = await putDistributor('da1-manage', 'not-a-uuid', {
      primaryDistributorId: DIST_1,
    });
    for (const response of [foreign, unknown, malformed]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(foreign.body).toBe(unknown.body);
    expect(foreign.body).toBe(malformed.body);
    expect(await storedDistributor(SHOP_C)).toBe(DIST_2);
  });

  it('B36: the platform scope honours X-Scope-Distributor on both sides of the write', async () => {
    // The shop is outside the scope…
    const outside = await putDistributor(
      'sa',
      SHOP_C,
      { primaryDistributorId: DIST_2 },
      {
        'x-scope-distributor': DIST_1,
      },
    );
    expect(outside.statusCode).toBe(404);
    // …and inside the scope, but targeting a distributor the scope cannot see.
    const crossTenant = await putDistributor(
      'sa',
      SHOP_C,
      { primaryDistributorId: DIST_1 },
      {
        'x-scope-distributor': DIST_2,
      },
    );
    expect(crossTenant.statusCode).toBe(404);
    expect(await storedDistributor(SHOP_C)).toBe(DIST_2);
  });

  it('B36: requires retailers.manage, a staff bearer, a strict body and a pool', async () => {
    const denied = await putDistributor('da1-view', SHOP_A, { primaryDistributorId: DIST_1 });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const anonymous = await app.inject({
      method: 'PUT',
      url: `/v1/admin/retailers/${SHOP_A}/primary-distributor`,
      payload: { primaryDistributorId: DIST_1 },
    });
    expect(anonymous.statusCode).toBe(401);

    for (const body of [
      {},
      { primaryDistributorId: null },
      { primaryDistributorId: 'not-a-uuid' },
      { primaryDistributorId: DIST_1, extra: 1 },
      { primaryDistributorId: 1 },
    ]) {
      const response = await putDistributor('da1-manage', SHOP_A, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }

    const noDb = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
    });
    try {
      const response = await noDb.inject({
        method: 'PUT',
        url: `/v1/admin/retailers/${SHOP_A}/primary-distributor`,
        headers: { authorization: 'Bearer da1-manage', 'content-type': 'application/json' },
        payload: { primaryDistributorId: DIST_1 },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await noDb.close();
    }
  });
});
