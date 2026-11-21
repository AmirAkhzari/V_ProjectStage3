import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
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
const DIST_OFF = '01000000-0000-4000-8000-000000000003';
const DIST_UNKNOWN = '01000000-0000-4000-8000-0000000000ff';

const SHOP_A = '02000000-0000-4000-8000-00000000000a';
const SHOP_B = '02000000-0000-4000-8000-00000000000b';
const SHOP_D = '02000000-0000-4000-8000-00000000000d';
const SHOP_PRO = '02000000-0000-4000-8000-00000000000e';
const SHOP_LAPSED = '02000000-0000-4000-8000-00000000000f';
const SHOP_MISSING = '02000000-0000-4000-8000-0000000000ff';

const PERIOD_PRO = '05000000-0000-4000-8000-000000000001';
const PERIOD_LAPSED = '05000000-0000-4000-8000-000000000002';

interface Principal {
  sid: string;
  accountId: string;
  status: 'active' | 'inactive';
  typ?: 'shopkeeper' | 'staff';
}

const PRINCIPALS = new Map<string, Principal>([
  ['tok-a', { sid: 'sid-a', accountId: SHOP_A, status: 'active' }],
  ['tok-b', { sid: 'sid-b', accountId: SHOP_B, status: 'active' }],
  ['tok-d', { sid: 'sid-d', accountId: SHOP_D, status: 'active' }],
  ['tok-pro', { sid: 'sid-pro', accountId: SHOP_PRO, status: 'active' }],
  ['tok-lapsed', { sid: 'sid-lapsed', accountId: SHOP_LAPSED, status: 'active' }],
  ['tok-missing', { sid: 'sid-missing', accountId: SHOP_MISSING, status: 'active' }],
  ['tok-inactive', { sid: 'sid-inactive', accountId: SHOP_A, status: 'inactive' }],
  ['tok-staff', { sid: 'sid-staff', accountId: SHOP_A, status: 'active', typ: 'staff' }],
]);

const verifier: AccessTokenVerifier = {
  verify: (token) => {
    const principal = PRINCIPALS.get(token);
    if (!principal) return Promise.reject(new Error('unknown token'));
    return Promise.resolve({
      sub: principal.accountId,
      typ: principal.typ ?? 'shopkeeper',
      sid: principal.sid,
      sv: 0,
    });
  },
};

function snapshotOf(principal: Principal): SessionSnapshot {
  return {
    sid: principal.sid,
    accountId: principal.accountId,
    typ: principal.typ ?? 'shopkeeper',
    familyId: `family-${principal.sid}`,
    sessionVersion: 0,
    accountStatus: principal.status,
    revokedAt: null,
    distributorId: null,
    staffRole: null,
    permissions: [],
    mustChangePassword: false,
  };
}

const authority: SessionAuthority = {
  hasPgFallback: true,
  check: (sid) => {
    for (const principal of PRINCIPALS.values()) {
      if (principal.sid !== sid) continue;
      if (principal.status !== 'active') {
        return Promise.resolve({ status: 'inactive' as const, row: snapshotOf(principal) });
      }
      return Promise.resolve({ status: 'active' as const, row: snapshotOf(principal) });
    }
    return Promise.resolve({ status: 'revoked' as const, reason: 'missing' });
  },
  rememberLive: () => Promise.resolve(),
  deny: () => Promise.resolve(),
  invalidateLive: () => Promise.resolve(),
  breakerState: () => 'closed',
  pgFallbackTotal: () => 0,
  pgLookupsFor: () => 0,
};

describe('A18 /v1/app/distributors/{id}', () => {
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
       VALUES ($1, 'Apex', 'active', now()),
              ($2, 'Boron', 'active', now()),
              ($3, 'Closed', 'inactive', now())`,
      [DIST_1, DIST_2, DIST_OFF],
    );
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, name, primary_distributor_id, status, created_at)
       VALUES ($1, $1, '09120000000a', 'فروشگاه الف', $4, 'active', now()),
              ($2, $2, '09120000000b', 'فروشگاه ب', $5, 'active', now()),
              ($3, $3, '09120000000d', 'فروشگاه د', $4, 'blocked', now()),
              ($6, $6, '09120000000e', 'فروشگاه حرفه‌ای', $4, 'active', now()),
              ($7, $7, '09120000000f', 'فروشگاه منقضی', $4, 'active', now())`,
      [SHOP_A, SHOP_B, SHOP_D, DIST_2, DIST_OFF, SHOP_PRO, SHOP_LAPSED],
    );
    // A14 periods: a live one (Pro unlocks the marketplace) and an expired one (Free again).
    await ownerPool.query(
      `INSERT INTO membership.subscriptions
         (id, shopkeeper_id, plan, amount, starts_at, expires_at, created_at)
       VALUES ($1, $3, 'pro', 1490000, now() - interval '1 day', now() + interval '29 days', now()),
              ($2, $4, 'pro', 1490000, now() - interval '60 days', now() - interval '30 days', now() - interval '60 days')`,
      [PERIOD_PRO, PERIOD_LAPSED, SHOP_PRO, SHOP_LAPSED],
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

  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const detail = (token: string, id: string) =>
    app.inject({
      method: 'GET',
      url: `/v1/app/distributors/${id}`,
      headers: headers(token),
    });

  it('A18 reads the shop its own primary distributor and is not cacheable', async () => {
    const response = await detail('tok-a', DIST_2);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
    expect(response.json()).toEqual({
      id: DIST_2,
      name: 'Boron',
      status: 'active',
      isPrimary: true,
    });
  });

  it('A18 answers 403 MARKETPLACE_REQUIRES_PRO for any other distributor on a free shop', async () => {
    const response = await detail('tok-a', DIST_1);
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: 'MARKETPLACE_REQUIRES_PRO',
        message: 'Marketplace requires the pro plan',
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('A18 gates before probing, so a non-primary unknown or inactive id is also a 403', async () => {
    for (const id of [DIST_UNKNOWN, DIST_OFF]) {
      const response = await detail('tok-a', id);
      expect(response.statusCode, id).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'MARKETPLACE_REQUIRES_PRO' } });
    }
  });

  it('A18 opens any active distributor to a Pro shop and keeps isPrimary honest', async () => {
    const other = await detail('tok-pro', DIST_1);
    expect(other.statusCode, other.body).toBe(200);
    expect(other.json()).toEqual({
      id: DIST_1,
      name: 'Apex',
      status: 'active',
      isPrimary: false,
    });

    const own = await detail('tok-pro', DIST_2);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ id: DIST_2, isPrimary: true });
  });

  it('A18 gates again once the Pro period has lapsed', async () => {
    const response = await detail('tok-lapsed', DIST_1);
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'MARKETPLACE_REQUIRES_PRO' } });

    // The shop's own primary distributor stays readable on Free.
    const own = await detail('tok-lapsed', DIST_2);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ id: DIST_2, isPrimary: true });
  });

  it('A18 answers the uniform 404 for a primary distributor RLS no longer shows', async () => {
    // Shop B was moved to a distributor that is now inactive, so the gate passes but the row is hidden.
    const response = await detail('tok-b', DIST_OFF);
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('A18 answers the uniform 404 for a non-uuid path id', async () => {
    const response = await detail('tok-a', 'd1');
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('A18 treats a blocked shop and a missing shop as the same 404', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      const response = await detail(token, DIST_2);
      expect(response.statusCode, token).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
  });

  it('A18 rejects an inactive account, a staff token and a missing token', async () => {
    const inactive = await detail('tok-inactive', DIST_2);
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const staff = await detail('tok-staff', DIST_2);
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

    const anonymous = await app.inject({ method: 'GET', url: `/v1/app/distributors/${DIST_2}` });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
  });
});
