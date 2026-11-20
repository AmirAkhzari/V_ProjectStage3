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

const address = (overrides: Record<string, unknown> = {}) => ({
  title: 'فروشگاه اصلی',
  fullAddress: 'تبریز، نیروی هوایی، گجیل، پلاک ۲۴',
  plaque: '۲۴',
  unit: '۱',
  tag: 'store',
  cityName: 'تبریز',
  lat: 38.08,
  lng: 46.29,
  streetLabel: 'نیروی هوایی',
  ...overrides,
});

describe('A9/A10 /v1/app/me/addresses', () => {
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
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, name, primary_distributor_id, status, created_at)
       VALUES ($1, $1, '09120000000a', 'فروشگاه الف', $4, 'active', now()),
              ($2, $2, '09120000000b', 'فروشگاه ب', $4, 'active', now()),
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
  const list = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me/addresses', headers: headers(token) });
  const create = (token: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/v1/app/me/addresses',
      headers: headers(token),
      payload: payload as Record<string, unknown>,
    });
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me', headers: headers(token) });

  const addressesOf = async (shopkeeperId: string) => {
    const found = await ownerPool.query<{
      id: string;
      title: string;
      default_address_id: string | null;
    }>(
      `SELECT a.id::text, a.title, s.default_address_id::text
         FROM customers.addresses a
         JOIN customers.shopkeepers s ON s.id = a.shopkeeper_id
        WHERE a.shopkeeper_id = $1
        ORDER BY a.created_at DESC, a.id DESC`,
      [shopkeeperId],
    );
    return found.rows;
  };

  it('A9 starts empty for a shop with no address, with no-store', async () => {
    const response = await list('tok-a');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([]);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
  });

  it('A10 saves the caller address, audits it, and A7 reports it as the default', async () => {
    const response = await create('tok-a', address({ title: '  فروشگاه اصلی  ' }));
    expect(response.statusCode, response.body).toBe(200);
    const saved = response.json();
    expect(saved).toMatchObject({
      title: 'فروشگاه اصلی',
      fullAddress: 'تبریز، نیروی هوایی، گجیل، پلاک ۲۴',
      plaque: '۲۴',
      unit: '۱',
      tag: 'store',
      branchName: null,
      cityName: 'تبریز',
      lat: 38.08,
      lng: 46.29,
      streetLabel: 'نیروی هوایی',
    });
    expect(response.headers['cache-control']).toBe('no-store');

    const profile = await me('tok-a');
    expect(profile.statusCode, profile.body).toBe(200);
    expect(profile.json()).toMatchObject({ defaultAddressId: saved.id });

    const listed = await list('tok-a');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ id: saved.id, title: 'فروشگاه اصلی' });

    const audits = await ownerPool.query<{
      action: string;
      actor_type: string;
      data: { addressId: string; cityName: string };
    }>(
      `SELECT action, actor_type, data FROM platform.audit_log
        WHERE entity = 'address' AND entity_id = $1`,
      [saved.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]).toMatchObject({
      action: 'shopkeeper_address_created',
      actor_type: 'shopkeeper',
      data: { addressId: saved.id, cityName: 'تبریز' },
    });
  });

  it('A10 makes every new address the default and A9 lists newest first', async () => {
    const first = (await list('tok-a')).json()[0].id;
    // Separate transactions, but keep a real gap so created_at (now()) is strictly ordered.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const response = await create(
      'tok-a',
      address({ title: 'انبار', tag: 'warehouse', plaque: '', unit: '', streetLabel: '' }),
    );
    expect(response.statusCode, response.body).toBe(200);
    const second = response.json().id;

    const profile = await me('tok-a');
    expect(profile.json()).toMatchObject({ defaultAddressId: second });

    const listed = await list('tok-a');
    expect(listed.json().map((row: { id: string }) => row.id)).toEqual([second, first]);
    expect(listed.json()[0]).toMatchObject({ tag: 'warehouse', plaque: '', streetLabel: '' });
  });

  it('A9/A10 never cross shops: B starts empty and A cannot see B rows', async () => {
    expect((await list('tok-b')).json()).toEqual([]);
    expect((await me('tok-b')).json()).toMatchObject({ defaultAddressId: null });

    const created = await create('tok-b', address({ title: 'شعبه ب', tag: 'branch' }));
    expect(created.statusCode, created.body).toBe(200);
    const bId = created.json().id;

    const a = await list('tok-a');
    expect(a.json()).toHaveLength(2);
    expect(a.json().map((row: { id: string }) => row.id)).not.toContain(bId);
    expect((await me('tok-b')).json()).toMatchObject({ defaultAddressId: bId });
    // The database agrees: one row per shop, each shop's default is its own.
    expect(await addressesOf(SHOP_A)).toHaveLength(2);
    expect(await addressesOf(SHOP_B)).toHaveLength(1);
  });

  it('A10 refuses invalid bodies and writes nothing', async () => {
    const before = (await addressesOf(SHOP_B)).length;
    for (const body of [
      {},
      address({ title: '' }),
      address({ title: 'x'.repeat(101) }),
      address({ title: 'a\nb' }),
      address({ lat: 91 }),
      address({ lng: 181 }),
      address({ lat: '38.08' }),
      address({ tag: 'other' }),
      address({ shopkeeperId: SHOP_A }),
      address({ id: SHOP_A }),
      address({ isDefault: false }),
      ['address'],
      null,
    ]) {
      const response = await create('tok-b', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect((await addressesOf(SHOP_B)).length).toBe(before);
  });

  it('A9/A10 treat a blocked row and a missing row as the same 404', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      for (const response of [await list(token), await create(token, address())]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
        });
      }
    }
    expect(await addressesOf(SHOP_D)).toHaveLength(0);
  });

  it('A9/A10 reject an inactive account, a staff token and a missing token', async () => {
    for (const [method, path] of [
      ['GET', '/v1/app/me/addresses'],
      ['POST', '/v1/app/me/addresses'],
    ] as const) {
      const inactive = await app.inject({
        method,
        url: path,
        headers: headers('tok-inactive'),
        ...(method === 'POST' ? { payload: address() } : {}),
      });
      expect(inactive.statusCode).toBe(401);
      expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

      const staff = await app.inject({
        method,
        url: path,
        headers: headers('tok-staff'),
        ...(method === 'POST' ? { payload: address() } : {}),
      });
      expect(staff.statusCode).toBe(401);
      expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

      const anonymous = await app.inject({
        method,
        url: path,
        ...(method === 'POST' ? { payload: address() } : {}),
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.headers['cache-control']).toBe('no-store');
    }
  });
});
