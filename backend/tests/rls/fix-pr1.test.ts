import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withTenant, type TenantContext } from '../../src/platform/db/tenant.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const T1 = '11111111-1111-1111-1111-111111111111',
  T2 = '22222222-2222-2222-2222-222222222222';
const SK_A = 'aa111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  SK_B = 'bb222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S = 'staff-a',
  S2 = 'staff-b';
const OWN = '04000000-0000-4000-8000-000000000001',
  OTHER = '04000000-0000-4000-8000-000000000002';
type Ctx = Partial<TenantContext> & { subjectId?: string };

describe('FIX PR1 containment (items 1-4)', () => {
  let deps: StartedPostgresRoles, ownerPool: pg.Pool, appPool: pg.Pool, identityPool: pg.Pool;
  const as = <T>(pool: pg.Pool, c: Ctx, fn: (client: pg.PoolClient) => Promise<T>) =>
    withTenant(pool, { ...c, subjectType: c.subjectType ?? 'staff' }, async (tx) => {
      if (c.subjectId)
        await tx.client.query(`SELECT set_config('app.subject_id', $1, true)`, [c.subjectId]);
      return fn(tx.client);
    });
  const expectCode = (run: Promise<unknown>, code: string) =>
    expect(run).rejects.toMatchObject({ code });
  const rows = (pool: pg.Pool, c: Ctx, sql: string, params: unknown[] = []) =>
    as(pool, c, (client) => client.query(sql, params)).then((r) => r.rowCount);
  const denied = (pool: pg.Pool, c: Ctx, sql: string, params: unknown[] = []) =>
    expectCode(
      as(pool, c, (client) => client.query(sql, params)),
      '42501',
    );
  const insertKey = (scope: string) => (client: pg.PoolClient) =>
    client.query(
      `INSERT INTO platform.idempotency_keys (scope, subject_id, key, request_hash, created_at) VALUES ($1, $2, 'new', 'h', now())`,
      [scope, S],
    );

  beforeAll(async () => {
    deps = await startPostgresWithRoles();
    ownerPool = new pg.Pool({ connectionString: deps.ownerUrl });
    appPool = new pg.Pool({ connectionString: deps.appUrl });
    identityPool = new pg.Pool({ connectionString: deps.identityUrl });
    for (const pool of [ownerPool, appPool, identityPool]) attachPgTeardownGuard(pool);
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers (id, account_id, phone, primary_distributor_id, status, created_at)
       VALUES ($1, gen_random_uuid(), '09120000001a', $3, 'active', now()), ($2, gen_random_uuid(), '09120000001b', $4, 'active', now())`,
      [SK_A, SK_B, T1, T2],
    );
    await ownerPool.query(
      `INSERT INTO payment.payments (id, shopkeeper_id, kind, amount, status, provider, idempotency_key, authority, paid_at, created_at, updated_at)
       VALUES ($1, $3, 'subscription', 1490000, 'pending', 'mock', 'fix-pr1-own-0001', 'auth-own', NULL, now(), now()),
              ($2, $4, 'subscription', 1490000, 'pending', 'mock', 'fix-pr1-other-01', 'auth-other', NULL, now(), now())`,
      [OWN, OTHER, SK_A, SK_B],
    );
    await ownerPool.query(
      `INSERT INTO platform.idempotency_keys (scope, subject_id, key, request_hash, response, status_code, created_at)
       VALUES ('B27:' || $1, $3, 'k1', 'h', '{"n":1}', 200, now()), ('B27:' || $2, $3, 'k2', 'h', '{"n":2}', 200, now()), ('B83:driver', $3, 'k3', 'h', '{"n":3}', 200, now())`,
      [T1, T2, S],
    );
  }, 120_000);
  afterAll(async () => {
    for (const pool of [identityPool, appPool, ownerPool]) await pool?.end();
    await deps?.postgres.stop();
  });

  it('1: idempotency policy is scope+subject+tenant bound', async () => {
    const scopes = (client: pg.PoolClient) =>
      client
        .query<{ scope: string }>(`SELECT scope FROM platform.idempotency_keys ORDER BY scope`)
        .then((r) => r.rows.map((x) => x.scope));
    expect(await as(appPool, { distributorId: T2, subjectId: S }, scopes)).toEqual([`B27:${T2}`]);
    const upd = `UPDATE platform.idempotency_keys SET response = '{}' WHERE scope IN ($1, 'B83:driver')`;
    expect(await rows(appPool, { distributorId: T2, subjectId: S }, upd, [`B27:${T1}`])).toBe(0);
    await expectCode(
      as(appPool, { distributorId: T2, subjectId: S }, insertKey(`B27:${T1}`)),
      '42501',
    );
    expect(await as(appPool, { distributorId: T2, subjectId: S2 }, scopes)).toEqual([]);
    expect(await as(appPool, { subjectType: 'system' }, scopes)).toEqual([]);
    await expectCode(as(appPool, { subjectType: 'system' }, insertKey(`B27:${T2}`)), '42501');
    expect(await as(appPool, { isPlatform: true, subjectId: S }, scopes)).toEqual([
      `B27:${T1}`,
      `B27:${T2}`,
    ]);
    expect(await as(identityPool, { subjectId: S }, scopes)).toEqual(['B83:driver']);
    await expectCode(as(identityPool, { subjectId: S }, insertKey(`B27:${T2}`)), '42501');
  });

  it('2: no role bypasses RLS and 0023 never grants it', async () => {
    const rows = await ownerPool.query(
      `SELECT rolname FROM pg_roles WHERE rolbypassrls AND rolname IN ('vproject_app', 'vproject_identity', 'vproject_worker', 'vproject_migrator')`,
    );
    expect(rows.rows).toEqual([]);
    expect(
      readFileSync(
        new URL('../../db/migrations/0023_fix_pr1_containment.sql', import.meta.url),
        'utf8',
      ),
    ).not.toMatch(/BYPASSRLS|ALTER\s+ROLE/i);
  });

  it('3: shop context cannot write subscriptions or payment money columns', async () => {
    const shop = { subjectType: 'shopkeeper' as const, shopkeeperId: SK_A };
    await denied(
      appPool,
      shop,
      `INSERT INTO membership.subscriptions (id, shopkeeper_id, plan, amount, starts_at, expires_at, created_at) VALUES (gen_random_uuid(), $1, 'pro', 0, now(), now() + interval '1 day', now())`,
      [SK_A],
    );
    await denied(
      appPool,
      shop,
      `INSERT INTO payment.payments (id, shopkeeper_id, kind, amount, status, provider, idempotency_key, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'subscription', 0, 'pending', 'mock', 'fix-pr1-new-0001', now(), now())`,
      [SK_A],
    );
    for (const set of [`status = 'paid'`, `paid_at = now()`, `amount = 1`])
      await denied(appPool, shop, `UPDATE payment.payments SET ${set} WHERE id = $1`, [OWN]);
    const auth = `UPDATE payment.payments SET authority = 'a2' WHERE id = $1`;
    expect(await rows(appPool, shop, auth, [OWN])).toBe(1);
    expect(await rows(appPool, shop, auth, [OTHER])).toBe(0);
    const cols = await ownerPool.query<{ column_name: string; allowed: boolean }>(
      `SELECT column_name, has_column_privilege('vproject_app', 'payment.payments', column_name, 'UPDATE') AS allowed FROM information_schema.columns WHERE table_schema = 'payment' AND table_name = 'payments' ORDER BY column_name`,
    );
    expect(cols.rows).toHaveLength(13);
    // A36's attempt counter is the one column payments re-entry adds; no financial column is writable.
    expect(cols.rows.filter((r) => r.allowed).map((r) => r.column_name)).toEqual([
      'authority',
      'redirect_url',
      'start_count',
      'updated_at',
    ]);
    const ins = await ownerPool.query(
      `SELECT has_table_privilege('vproject_app', t, 'INSERT') AS i FROM unnest(ARRAY['payment.payments', 'membership.subscriptions']) t`,
    );
    expect(ins.rows).toEqual([{ i: false }, { i: false }]);
  });

  it('4: shopkeepers guard allows only the first primary choice', async () => {
    const shop = { subjectType: 'shopkeeper' as const, shopkeeperId: SK_A };
    const status = (v: string) => `UPDATE customers.shopkeepers SET status = '${v}' WHERE id = $1`;
    const pick = `UPDATE customers.shopkeepers SET primary_distributor_id = $2 WHERE id = $1`;
    await denied(appPool, shop, status('blocked'), [SK_A]);
    await denied(appPool, shop, pick, [SK_A, T2]);
    await denied(appPool, { subjectType: 'system', shopkeeperId: SK_A }, status('blocked'), [SK_A]);
    await ownerPool.query(
      `UPDATE customers.shopkeepers SET primary_distributor_id = NULL WHERE id = $1`,
      [SK_A],
    );
    expect(await rows(appPool, shop, pick, [SK_A, T2])).toBe(1);
    expect(await rows(appPool, { distributorId: T2 }, status('blocked'), [SK_A])).toBe(1);
    expect(await rows(appPool, { isPlatform: true }, status('active'), [SK_A])).toBe(1);
  });
});
