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
const DIST_ABSENT = '02000000-0000-4000-8000-0000000000ff';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };

interface Principal {
  sid: string;
  role: 'distributor_admin' | 'super_admin';
  distributorId: string | null;
  permissions: readonly string[];
}

const PRINCIPALS = new Map<string, Principal>([
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
    'da1-view',
    {
      sid: 'sid-da1-view',
      role: 'distributor_admin',
      distributorId: DIST_1,
      permissions: ['distributors.view'],
    },
  ],
  [
    'da1-manage-b',
    {
      sid: 'sid-da1-manage-b',
      role: 'distributor_admin',
      distributorId: DIST_1,
      permissions: ['distributors.manage'],
    },
  ],
  [
    'da2-manage',
    {
      sid: 'sid-da2-manage',
      role: 'distributor_admin',
      distributorId: DIST_2,
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

function withoutRequestId(headers: Record<string, unknown>): Record<string, unknown> {
  const { 'x-request-id': _requestId, ...rest } = headers;
  return rest;
}

describe('B27 tenant profile update', () => {
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
              ($2, 'Distributor 2', 'paused', now())`,
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
    await ownerPool.query(`DELETE FROM platform.audit_log`);
    await ownerPool.query(`DELETE FROM platform.idempotency_keys`);
    await ownerPool.query(
      `UPDATE tenancy.distributors SET name = 'Distributor 1', status = 'active' WHERE id = $1`,
      [DIST_1],
    );
    await ownerPool.query(
      `UPDATE tenancy.distributors SET name = 'Distributor 2', status = 'paused' WHERE id = $1`,
      [DIST_2],
    );
  });

  afterAll(async () => {
    await app?.close();
    await appPool?.end();
    await ownerPool?.end();
    await pgRoles?.postgres.stop();
  });

  const put = (token: string, id: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'PUT',
      url: `/v1/admin/distributors/${id}`,
      headers: { authorization: `Bearer ${token}`, ...headers },
      payload: body as Record<string, unknown>,
    });

  const auditRows = async () =>
    (
      await ownerPool.query<{ action: string; actor_id: string; data: Record<string, unknown> }>(
        `SELECT action, actor_id, data FROM platform.audit_log ORDER BY at`,
      )
    ).rows;

  const nameOf = async (id: string) =>
    (
      await ownerPool.query<{ name: string; status: string }>(
        `SELECT name, status FROM tenancy.distributors WHERE id = $1`,
        [id],
      )
    ).rows[0];

  it('renames the caller tenant and audits the before/after instead of financial fields', async () => {
    const response = await put('da1-manage', DIST_1, { name: '  پخش شمال  ' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      id: DIST_1,
      name: 'پخش شمال',
      status: 'active',
      createdAt: expect.any(String),
    });
    expect(await nameOf(DIST_1)).toEqual({ name: 'پخش شمال', status: 'active' });
    const audited = await auditRows();
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: 'distributor_profile_updated',
      actor_id: 'staff-sid-da1-manage',
      data: { distributorId: DIST_1, nameBefore: 'Distributor 1', nameAfter: 'پخش شمال' },
    });
  });

  it('makes a foreign tenant byte-identical to a missing resource and changes nothing', async () => {
    const foreign = await put('da1-manage', DIST_2, { name: 'hijack' });
    const missing = await put('da1-manage', DIST_ABSENT, { name: 'hijack' });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.statusCode).not.toBe(403);
    expect(foreign.body).toBe(missing.body);
    expect(foreign.json()).toEqual(NOT_FOUND);
    expect(withoutRequestId(foreign.headers)).toEqual(withoutRequestId(missing.headers));
    expect(await nameOf(DIST_2)).toEqual({ name: 'Distributor 2', status: 'paused' });
    expect(await auditRows()).toHaveLength(0);
  });

  it('answers a malformed id with the same NOT_FOUND envelope', async () => {
    const malformed = await put('da1-manage', 'not-a-uuid', { name: 'x' });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.body).toBe((await put('da1-manage', DIST_ABSENT, { name: 'x' })).body);
  });

  it('rejects a financial or operational field with 400 and leaves the row untouched', async () => {
    for (const payload of [
      { name: 'ok', status: 'inactive' },
      { name: 'ok', commission: 5 },
      { name: 'ok', distributorId: DIST_2 },
      { name: '   ' },
      { name: 'a'.repeat(201) },
    ]) {
      const response = await put('da1-manage', DIST_1, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(await nameOf(DIST_1)).toEqual({ name: 'Distributor 1', status: 'active' });
    expect(await auditRows()).toHaveLength(0);
  });

  it('treats an unchanged name as a no-op: 200, no audit row', async () => {
    const response = await put('da1-manage', DIST_1, { name: 'Distributor 1' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Distributor 1' });
    expect(await auditRows()).toHaveLength(0);
  });

  it('requires distributors.manage, not distributors.view', async () => {
    const denied = await put('da1-view', DIST_1, { name: 'x' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await nameOf(DIST_1)).toEqual({ name: 'Distributor 1', status: 'active' });
  });

  it('replays an identical Idempotency-Key once and rejects a different body', async () => {
    const key = 'b27-key-0123456789';
    const first = await put('da1-manage', DIST_1, { name: 'پخش اول' }, { 'idempotency-key': key });
    const second = await put('da1-manage', DIST_1, { name: 'پخش اول' }, { 'idempotency-key': key });
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.body).toBe(first.body);
    expect(await auditRows()).toHaveLength(1);

    const reused = await put('da1-manage', DIST_1, { name: 'پخش دوم' }, { 'idempotency-key': key });
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSE' } });
    expect(await nameOf(DIST_1)).toEqual({ name: 'پخش اول', status: 'active' });
    expect(await auditRows()).toHaveLength(1);
  });

  it('validates a present Idempotency-Key instead of ignoring it', async () => {
    const short = await put('da1-manage', DIST_1, { name: 'x' }, { 'idempotency-key': 'short' });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await nameOf(DIST_1)).toEqual({ name: 'Distributor 1', status: 'active' });
  });

  it('lets a super admin edit any tenant, and the scope header narrows it back to 404', async () => {
    const platform = await put('sa', DIST_2, { name: 'پخش دوم' });
    expect(platform.statusCode, platform.body).toBe(200);
    expect(platform.json()).toMatchObject({ id: DIST_2, name: 'پخش دوم' });

    const scoped = await put('sa', DIST_2, { name: 'hijack' }, { 'x-scope-distributor': DIST_1 });
    expect(scoped.statusCode).toBe(404);
    expect(scoped.json()).toEqual(NOT_FOUND);
    expect(await nameOf(DIST_2)).toEqual({ name: 'پخش دوم', status: 'paused' });
  });

  it('scopes an Idempotency-Key to the caller, so a same-tenant colleague is not replayed', async () => {
    const key = 'b27-shared-key-0123456789';
    const before = await auditRows();
    const first = await put('da1-manage', DIST_1, { name: 'پخش الف' }, { 'idempotency-key': key });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ id: DIST_1, name: 'پخش الف' });
    const afterFirst = await auditRows();
    expect(afterFirst).toHaveLength(before.length + 1);

    const second = await put('da1-manage-b', DIST_1, { name: 'پخش ب' }, { 'idempotency-key': key });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ id: DIST_1, name: 'پخش ب' });
    expect(second.body).not.toBe(first.body);
    expect(await nameOf(DIST_1)).toEqual({ name: 'پخش ب', status: 'active' });

    const afterSecond = await auditRows();
    expect(afterSecond).toHaveLength(afterFirst.length + 1);
    expect(afterSecond.at(-1)).toMatchObject({
      action: 'distributor_profile_updated',
      actor_id: 'staff-sid-da1-manage-b',
      data: { distributorId: DIST_1, nameBefore: 'پخش الف', nameAfter: 'پخش ب' },
    });
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
        method: 'PUT',
        url: `/v1/admin/distributors/${DIST_1}`,
        headers: { authorization: 'Bearer da1-manage' },
        payload: { name: 'x' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      await noDb.close();
    }
  });
});
