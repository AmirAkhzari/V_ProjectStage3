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
const UNKNOWN_ID = '03000000-0000-4000-8000-0000000000ff';

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

describe('A11/A12/A13 /v1/app/me/addresses', () => {
  let pgRoles: StartedPostgresRoles;
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let app: App;

  // Filled by the first test; the later tests build on the same book, like a real client would.
  let first = '';
  let second = '';

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
  const edit = (token: string, id: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/v1/app/me/addresses/${id}`,
      headers: headers(token),
      payload: payload as Record<string, unknown>,
    });
  const choose = (token: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/v1/app/me/addresses/default',
      headers: headers(token),
      payload: payload as Record<string, unknown>,
    });
  const remove = (token: string, id: string) =>
    app.inject({
      method: 'DELETE',
      url: `/v1/app/me/addresses/${id}`,
      headers: headers(token),
    });
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me', headers: headers(token) });

  const auditCount = async (addressId: string, action: string) => {
    const found = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.audit_log
        WHERE entity = 'address' AND entity_id = $1 AND action = $2`,
      [addressId, action],
    );
    return Number(found.rows[0]?.c ?? '0');
  };

  const rowOf = async (addressId: string) => {
    const found = await ownerPool.query<{
      title: string;
      city_name: string;
      shopkeeper_id: string;
      deleted_at: Date | null;
    }>(
      `SELECT title, city_name, shopkeeper_id::text, deleted_at
         FROM customers.addresses WHERE id = $1`,
      [addressId],
    );
    return found.rows[0] ?? null;
  };

  it('A10 seeds the book the later operations work on', async () => {
    const created = await create('tok-a', address());
    expect(created.statusCode, created.body).toBe(200);
    first = created.json().id;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const created2 = await create('tok-a', address({ title: 'انبار', tag: 'warehouse' }));
    expect(created2.statusCode, created2.body).toBe(200);
    second = created2.json().id;
    expect([first, second]).not.toContain('');
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: second });
  });

  it('A11 rewrites the address, audits it and keeps the default and the list order', async () => {
    const before = (await list('tok-a')).json().map((row: { id: string }) => row.id);
    expect(before).toEqual([second, first]);

    const response = await edit(
      'tok-a',
      first,
      address({
        title: '  فروشگاه مرکزی  ',
        fullAddress: 'تبریز، گجیل، خیابان ۲۹ بهمن',
        cityName: ' تبریز ',
        lat: 38.09,
        lng: 46.3,
      }),
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: first,
      title: 'فروشگاه مرکزی',
      fullAddress: 'تبریز، گجیل، خیابان ۲۹ بهمن',
      cityName: 'تبریز',
      lat: 38.09,
      lng: 46.3,
    });
    expect(response.headers['cache-control']).toBe('no-store');

    // Rewriting is not re-creating: the id, the position and the default all stay put.
    const after = (await list('tok-a')).json().map((row: { id: string }) => row.id);
    expect(after).toEqual([second, first]);
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: second });
    expect(await rowOf(first)).toMatchObject({ title: 'فروشگاه مرکزی', deleted_at: null });

    const audits = await ownerPool.query<{ actor_type: string; data: { cityName: string } }>(
      `SELECT actor_type, data FROM platform.audit_log
        WHERE entity = 'address' AND entity_id = $1 AND action = 'shopkeeper_address_updated'`,
      [first],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]).toMatchObject({ actor_type: 'shopkeeper', data: { cityName: 'تبریز' } });
  });

  it('A11 saving the same values again is a 200 no-op with no second audit row', async () => {
    const body = address({
      title: 'فروشگاه مرکزی',
      fullAddress: 'تبریز، گجیل، خیابان ۲۹ بهمن',
      lat: 38.09,
      lng: 46.3,
    });
    const response = await edit('tok-a', first, body);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: first, title: 'فروشگاه مرکزی' });
    expect(await auditCount(first, 'shopkeeper_address_updated')).toBe(1);
  });

  it('A11 refuses invalid bodies and writes nothing', async () => {
    for (const body of [
      {},
      address({ title: '' }),
      address({ title: 'a\nb' }),
      address({ lat: 91 }),
      address({ shopkeeperId: SHOP_B }),
      address({ isDefault: true }),
      null,
    ]) {
      const response = await edit('tok-a', first, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect((await rowOf(first))?.title).toBe('فروشگاه مرکزی');
  });

  it('A11 answers 404 for an id that is not one of the shop rows', async () => {
    // `/me/addresses/default` is A12's static route, so only malformed and absent ids reach A11.
    for (const id of ['not-a-uuid', UNKNOWN_ID]) {
      const response = await edit('tok-a', id, address());
      expect(response.statusCode, id).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
  });

  it('A12 moves the default, A7 reports it, and choosing it again is a no-op', async () => {
    const response = await choose('tok-a', { addressId: first });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ defaultAddressId: first });
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: first });
    expect(await auditCount(first, 'shopkeeper_default_address_changed')).toBe(1);

    const again = await choose('tok-a', { addressId: first });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual({ defaultAddressId: first });
    expect(await auditCount(first, 'shopkeeper_default_address_changed')).toBe(1);
  });

  it('A12 refuses extra keys and malformed ids, and 404s for an address it cannot see', async () => {
    for (const body of [
      {},
      { addressId: 'not-a-uuid' },
      { addressId: first, isDefault: true },
      { id: first },
      null,
    ]) {
      const response = await choose('tok-a', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
    for (const body of [{ addressId: UNKNOWN_ID }]) {
      const response = await choose('tok-a', body);
      expect(response.statusCode).toBe(404);
    }
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: first });

    // B may not point at A's row: RLS hides it, so it is the same 404 as an absent id.
    const created = await create('tok-b', address({ title: 'شعبه ب', tag: 'branch' }));
    expect(created.statusCode, created.body).toBe(200);
    const bId = created.json().id;
    const foreign = await choose('tok-b', { addressId: second });
    expect(foreign.statusCode).toBe(404);
    expect((await me('tok-b')).json()).toMatchObject({ defaultAddressId: bId });
  });

  it('A13 soft-deletes the default address, clears the pointer and audits it', async () => {
    const response = await remove('tok-a', first);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ id: first, defaultAddressId: null });
    expect(response.headers['cache-control']).toBe('no-store');

    // A9 hides it, A7 stops pointing at it, but the row itself is still there.
    expect((await list('tok-a')).json().map((row: { id: string }) => row.id)).toEqual([second]);
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: null });
    const row = await rowOf(first);
    expect(row).not.toBeNull();
    expect(row?.deleted_at).toBeInstanceOf(Date);
    expect(row?.title).toBe('فروشگاه مرکزی');

    const audits = await ownerPool.query<{ data: { wasDefault: boolean } }>(
      `SELECT data FROM platform.audit_log
        WHERE entity = 'address' AND entity_id = $1 AND action = 'shopkeeper_address_deleted'`,
      [first],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.data.wasDefault).toBe(true);

    // A deleted address is gone from every address operation, not just from A9.
    for (const response of [
      await remove('tok-a', first),
      await edit('tok-a', first, address()),
      await choose('tok-a', { addressId: first }),
    ]) {
      expect(response.statusCode).toBe(404);
    }
    expect(await auditCount(first, 'shopkeeper_address_deleted')).toBe(1);
  });

  it('A12/A13 keep a non-default address deletable without touching the default', async () => {
    const created = await create('tok-a', address({ title: 'شعبه دوم', tag: 'branch' }));
    expect(created.statusCode, created.body).toBe(200);
    const third = created.json().id;
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: third });

    const chose = await choose('tok-a', { addressId: second });
    expect(chose.statusCode, chose.body).toBe(200);
    const removed = await remove('tok-a', third);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toEqual({ id: third, defaultAddressId: second });
    expect((await me('tok-a')).json()).toMatchObject({ defaultAddressId: second });

    const deleted = await ownerPool.query<{ data: { wasDefault: boolean } }>(
      `SELECT data FROM platform.audit_log
        WHERE entity = 'address' AND entity_id = $1 AND action = 'shopkeeper_address_deleted'`,
      [third],
    );
    expect(deleted.rows[0]?.data.wasDefault).toBe(false);
  });

  it('A11/A12/A13 never cross shops', async () => {
    const hijack = 'هک شده';
    const bId = (await list('tok-b')).json()[0].id;

    expect((await edit('tok-a', bId, address({ title: hijack }))).statusCode).toBe(404);
    expect((await remove('tok-a', bId)).statusCode).toBe(404);
    expect((await edit('tok-b', second, address({ title: hijack }))).statusCode).toBe(404);
    expect((await remove('tok-b', second)).statusCode).toBe(404);

    // The database agrees: B's row and A's row kept their own titles and their own owner.
    expect(await rowOf(bId)).toMatchObject({ title: 'شعبه ب', deleted_at: null });
    expect(await rowOf(second)).toMatchObject({ shopkeeper_id: SHOP_A, deleted_at: null });
  });

  it('A11/A12/A13 treat a blocked row and a missing row as the same 404', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      for (const response of [
        await edit(token, UNKNOWN_ID, address()),
        await choose(token, { addressId: UNKNOWN_ID }),
        await remove(token, UNKNOWN_ID),
      ]) {
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
        });
      }
    }
    const dRows = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM customers.addresses WHERE shopkeeper_id = $1`,
      [SHOP_D],
    );
    expect(dRows.rows[0]?.c).toBe('0');
  });

  it('A11/A12/A13 reject an inactive account, a staff token and a missing token', async () => {
    const calls = [
      (token?: string) =>
        app.inject({
          method: 'PUT',
          url: `/v1/app/me/addresses/${UNKNOWN_ID}`,
          headers: token ? headers(token) : {},
          payload: address(),
        }),
      (token?: string) =>
        app.inject({
          method: 'PUT',
          url: '/v1/app/me/addresses/default',
          headers: token ? headers(token) : {},
          payload: { addressId: UNKNOWN_ID },
        }),
      (token?: string) =>
        app.inject({
          method: 'DELETE',
          url: `/v1/app/me/addresses/${UNKNOWN_ID}`,
          headers: token ? headers(token) : {},
        }),
    ];
    for (const call of calls) {
      const inactive = await call('tok-inactive');
      expect(inactive.statusCode).toBe(401);
      expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

      const staff = await call('tok-staff');
      expect(staff.statusCode).toBe(401);
      expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

      const anonymous = await call();
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.headers['cache-control']).toBe('no-store');
    }
  });
});
