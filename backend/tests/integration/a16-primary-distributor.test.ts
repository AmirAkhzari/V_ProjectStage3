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

describe('A16 /v1/app/me/primary-distributor', () => {
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
    // An inactive distributor exists but is not a valid choice, so RLS must hide it from the app.
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at)
       VALUES ($1, 'پخش یک', 'active', now()),
              ($2, 'پخش دو', 'active', now()),
              ($3, 'پخش غیرفعال', 'inactive', now())`,
      [DIST_1, DIST_2, DIST_OFF],
    );
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, name, primary_distributor_id, status, created_at)
       VALUES ($1, $1, '09120000000a', 'فروشگاه الف', NULL, 'active', now()),
              ($2, $2, '09120000000b', 'فروشگاه ب', NULL, 'active', now()),
              ($3, $3, '09120000000d', 'فروشگاه د', $4, 'blocked', now())`,
      [SHOP_A, SHOP_B, SHOP_D, DIST_1],
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
  const choose = (token: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/v1/app/me/primary-distributor',
      headers: headers(token),
      payload: payload as Record<string, unknown>,
    });
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me', headers: headers(token) });

  const primaryOf = async (shopkeeperId: string) => {
    const found = await ownerPool.query<{ primary_distributor_id: string | null }>(
      `SELECT primary_distributor_id::text FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    return found.rows[0]?.primary_distributor_id ?? null;
  };

  const auditsOf = async (shopkeeperId: string) => {
    const found = await ownerPool.query<{
      actor_type: string;
      distributor_id: string | null;
      data: { distributorBefore: string | null; distributorAfter: string };
    }>(
      `SELECT actor_type, distributor_id::text, data FROM platform.audit_log
        WHERE entity = 'shopkeeper' AND entity_id = $1
          AND action = 'shopkeeper_primary_distributor_changed'
        ORDER BY at, id`,
      [shopkeeperId],
    );
    return found.rows;
  };

  it('A16 saves the chosen distributor, audits it and A7 reports it', async () => {
    const response = await choose('tok-a', { primaryDistributorId: DIST_1 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ primaryDistributorId: DIST_1 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();

    expect((await me('tok-a')).json()).toMatchObject({ primaryDistributorId: DIST_1 });
    expect(await primaryOf(SHOP_A)).toBe(DIST_1);

    const audits = await auditsOf(SHOP_A);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_type: 'shopkeeper',
      distributor_id: DIST_1,
      data: { distributorBefore: null, distributorAfter: DIST_1 },
    });
  });

  it('A16 choosing the same distributor again is a 200 no-op with no second audit row', async () => {
    const response = await choose('tok-a', { primaryDistributorId: DIST_1 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ primaryDistributorId: DIST_1 });
    expect(await auditsOf(SHOP_A)).toHaveLength(1);
    expect(await primaryOf(SHOP_A)).toBe(DIST_1);
  });

  it('A16 treats the choice as one-time: another distributor is a 409 DISTRIBUTOR_LOCKED', async () => {
    const response = await choose('tok-a', { primaryDistributorId: DIST_2 });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'DISTRIBUTOR_LOCKED', message: 'Primary distributor is already chosen' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await me('tok-a')).json()).toMatchObject({ primaryDistributorId: DIST_1 });
    expect(await primaryOf(SHOP_A)).toBe(DIST_1);
    expect(await auditsOf(SHOP_A)).toHaveLength(1);
  });

  it('A16 locks before probing the target, so an inactive or unknown id is also a 409', async () => {
    for (const primaryDistributorId of [DIST_OFF, DIST_UNKNOWN]) {
      const response = await choose('tok-a', { primaryDistributorId });
      expect(response.statusCode, primaryDistributorId).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'DISTRIBUTOR_LOCKED' } });
    }
    // The lock answer never depends on whether the distributor exists or is active.
    expect(await primaryOf(SHOP_A)).toBe(DIST_1);
    expect(await auditsOf(SHOP_A)).toHaveLength(1);
  });

  it('A16 refuses malformed bodies and writes nothing', async () => {
    for (const body of [
      {},
      // `distributorId` is the request's own scope: the platform hook or the strict body refuses it.
      { distributorId: DIST_1 },
      { primaryDistributorId: DIST_1, distributorId: DIST_1 },
      { primaryDistributorId: 'd1' },
      { primaryDistributorId: null },
      { primaryDistributorId: DIST_1, extra: true },
      { shopkeeperId: SHOP_A, primaryDistributorId: DIST_1 },
      ['primaryDistributorId'],
      null,
    ]) {
      const response = await choose('tok-a', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(await primaryOf(SHOP_A)).toBe(DIST_1);
    expect(await auditsOf(SHOP_A)).toHaveLength(1);
  });

  it('A16 answers 404 for an unknown and for an inactive distributor on a fresh shop', async () => {
    for (const primaryDistributorId of [DIST_UNKNOWN, DIST_OFF]) {
      const response = await choose('tok-b', { primaryDistributorId });
      expect(response.statusCode, primaryDistributorId).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
    // The invisible distributor never reaches the shop's row, so the one-time choice is still open.
    expect(await primaryOf(SHOP_B)).toBeNull();
    expect(await auditsOf(SHOP_B)).toHaveLength(0);
  });

  it('A16 never crosses shops: B changes only its own row, then locks too', async () => {
    const response = await choose('tok-b', { primaryDistributorId: DIST_1 });
    expect(response.statusCode, response.body).toBe(200);
    expect(await primaryOf(SHOP_B)).toBe(DIST_1);
    expect(await primaryOf(SHOP_A)).toBe(DIST_1);
    expect(await auditsOf(SHOP_B)).toHaveLength(1);
    expect(await auditsOf(SHOP_A)).toHaveLength(1);

    const moved = await choose('tok-b', { primaryDistributorId: DIST_2 });
    expect(moved.statusCode).toBe(409);
    expect(await primaryOf(SHOP_B)).toBe(DIST_1);
    expect(await auditsOf(SHOP_B)).toHaveLength(1);
  });

  it('A16 treats a blocked row and a missing row as the same 404', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      const response = await choose(token, { primaryDistributorId: DIST_1 });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
    // The blocked shop keeps whatever B33/B35 gave it; no write happened.
    expect(await primaryOf(SHOP_D)).toBe(DIST_1);
  });

  it('A16 rejects an inactive account, a staff token and a missing token', async () => {
    const inactive = await choose('tok-inactive', { primaryDistributorId: DIST_1 });
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const staff = await choose('tok-staff', { primaryDistributorId: DIST_1 });
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

    const anonymous = await app.inject({
      method: 'POST',
      url: '/v1/app/me/primary-distributor',
      payload: { primaryDistributorId: DIST_1 },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
  });
});
