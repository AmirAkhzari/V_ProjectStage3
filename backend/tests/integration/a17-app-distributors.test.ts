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

const SHOP_A = '02000000-0000-4000-8000-00000000000a';
const SHOP_B = '02000000-0000-4000-8000-00000000000b';
const SHOP_D = '02000000-0000-4000-8000-00000000000d';
const SHOP_MISSING = '02000000-0000-4000-8000-0000000000ff';

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

describe('A17 /v1/app/distributors', () => {
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
              ($2, $2, '09120000000b', 'فروشگاه ب', NULL, 'active', now()),
              ($3, $3, '09120000000d', 'فروشگاه د', NULL, 'blocked', now())`,
      [SHOP_A, SHOP_B, SHOP_D, DIST_2],
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
  const list = (token: string, query = '') =>
    app.inject({
      method: 'GET',
      url: `/v1/app/distributors${query}`,
      headers: headers(token),
    });

  it('A17 lists only active distributors, marks the caller primary and is not cacheable', async () => {
    const response = await list('tok-a');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
    expect(response.json()).toEqual([
      { id: DIST_1, name: 'Apex', status: 'active', isPrimary: false, locked: false },
      { id: DIST_2, name: 'Boron', status: 'active', isPrimary: true, locked: false },
    ]);
  });

  it('A17 marks isPrimary per shop, so the same list answers each caller differently', async () => {
    const response = await list('tok-b');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([
      { id: DIST_1, name: 'Apex', status: 'active', isPrimary: false, locked: false },
      { id: DIST_2, name: 'Boron', status: 'active', isPrimary: false, locked: false },
    ]);
  });

  it('A17 accepts cityId (validated but not narrowing until distributors have a city)', async () => {
    const withCity = await list('tok-a', '?cityId=tabriz');
    expect(withCity.statusCode, withCity.body).toBe(200);
    expect(withCity.json().map((row: { id: string }) => row.id)).toEqual([DIST_1, DIST_2]);
  });

  it('A17 refuses a repeated, empty or over-long cityId', async () => {
    for (const query of ['?cityId=', '?cityId=tabriz&cityId=karaj', `?cityId=${'x'.repeat(65)}`]) {
      const response = await list('tok-a', query);
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('A17 treats a blocked shop and a missing shop as the same 404', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      const response = await list(token);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
  });

  it('A17 rejects an inactive account, a staff token and a missing token', async () => {
    const inactive = await list('tok-inactive');
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const staff = await list('tok-staff');
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

    const anonymous = await app.inject({ method: 'GET', url: '/v1/app/distributors' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
  });
});
