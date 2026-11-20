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

describe('A8 PATCH /v1/app/me', () => {
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
    // Shop B already has a name; A starts without one, exactly like the rows 0017 backfills to null.
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, name, primary_distributor_id, status, created_at)
       VALUES ($1, $1, '09120000000a', NULL, $4, 'active', now()),
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

  const patch = (token: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'PATCH',
      url: '/v1/app/me',
      headers: { authorization: `Bearer ${token}`, ...headers },
      payload: payload as Record<string, unknown>,
    });

  const storedName = async (id: string) => {
    const found = await ownerPool.query<{ name: string | null }>(
      `SELECT name FROM customers.shopkeepers WHERE id = $1`,
      [id],
    );
    return found.rows[0]?.name ?? null;
  };

  const auditsFor = async (id: string) => {
    const found = await ownerPool.query<{
      action: string;
      actor_type: string;
      data: { nameBefore: string | null; nameAfter: string | null };
    }>(
      `SELECT action, actor_type, data FROM platform.audit_log
        WHERE entity = 'shopkeeper' AND entity_id = $1
        ORDER BY at`,
      [id],
    );
    return found.rows;
  };

  it('A8 saves the caller name only, and A7 reads it back', async () => {
    const response = await patch('tok-a', { name: '  فروشگاه الف  ' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      user: { id: SHOP_A, name: 'فروشگاه الف', phone: '09120000000a' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await storedName(SHOP_A)).toBe('فروشگاه الف');
    expect(await storedName(SHOP_B)).toBe('فروشگاه ب');

    const read = await app.inject({
      method: 'GET',
      url: '/v1/app/me',
      headers: { authorization: 'Bearer tok-a' },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({ user: { id: SHOP_A, name: 'فروشگاه الف' } });

    const audits = await auditsFor(SHOP_A);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'shopkeeper_name_updated',
      actor_type: 'shopkeeper',
      data: { nameBefore: null, nameAfter: 'فروشگاه الف' },
    });
  });

  it('A8 is idempotent: the same name is a 200 no-op with no new audit row', async () => {
    const before = (await auditsFor(SHOP_A)).length;
    const response = await patch('tok-a', { name: 'فروشگاه الف' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ user: { name: 'فروشگاه الف' } });
    expect((await auditsFor(SHOP_A)).length).toBe(before);
  });

  it('A8 never reaches another shop, even by naming it in the body', async () => {
    for (const body of [
      { name: 'hacked', shopkeeperId: SHOP_B },
      { name: 'hacked', id: SHOP_B },
      { shopkeeperId: SHOP_B, name: 'hacked' },
    ]) {
      const response = await patch('tok-a', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(await storedName(SHOP_B)).toBe('فروشگاه ب');
    expect(await auditsFor(SHOP_B)).toHaveLength(0);
  });

  it('A8 refuses invalid names and leaves the row untouched', async () => {
    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: 'a\nb' },
      { name: 'a\tb' },
      { name: 5 },
      { name: null },
      { name: 'ok', status: 'blocked' },
      ['ok'],
      null,
    ]) {
      const response = await patch('tok-b', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(await storedName(SHOP_B)).toBe('فروشگاه ب');
    expect(await auditsFor(SHOP_B)).toHaveLength(0);
  });

  it('A8 keeps the 100-code-point boundary, counting code points rather than UTF-16 units', async () => {
    const hundred = '🏪'.repeat(100);
    const saved = await patch('tok-b', { name: hundred });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ user: { name: hundred } });
    // 101 emoji is 202 UTF-16 units but still one code point too many.
    const tooLong = await patch('tok-b', { name: '🏪'.repeat(101) });
    expect(tooLong.statusCode).toBe(400);
  });

  it('A8 treats a blocked row and a missing row as the same 404', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      const response = await patch(token, { name: 'فروشگاه جدید' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
    expect(await storedName(SHOP_D)).toBe('فروشگاه د');
  });

  it('A8 rejects an inactive account, a staff token and a missing token', async () => {
    const inactive = await patch('tok-inactive', { name: 'x' });
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const staff = await patch('tok-staff', { name: 'x' });
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

    const anonymous = await app.inject({
      method: 'PATCH',
      url: '/v1/app/me',
      payload: { name: 'x' },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
  });
});
