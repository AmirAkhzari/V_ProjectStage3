import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_SCHEMAS } from '../../src/platform/modules.js';
import { withTenant } from '../../src/platform/db/tenant.js';
import { parseScopeDistributorHeader } from '../../src/platform/http/scope.js';
import { assertRuntimeDbRole } from '../../src/platform/db/runtimeRole.js';
import { databaseUrlAs } from '../../src/platform/db/roles.js';
import { SEED, seedDemoTenants } from '../../scripts/seed.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  TEST_ROLE_PASSWORD,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const INFRA_TABLES = ['outbox_events', 'inbox_processed', 'audit_log', 'idempotency_keys'];
const GATE_SCHEMAS = DB_SCHEMAS;
const RLS_EXEMPT_TABLES = new Set(INFRA_TABLES.map((table) => `platform.${table}`));
/** Identity tables that use USING (true); still ENABLE+FORCE RLS (AppSec 7-3). */
const IDENTITY_UNSCOPED = [
  'identity.accounts',
  'identity.otp_challenges',
  'identity.pending_session_denies',
  'identity.refresh_tokens',
  'identity.sessions',
] as const;
/** Fail-closed: every non-exempt, non-unscoped table in GATE_SCHEMAS must appear here. */
const HARNESS_TENANT_TABLES = [
  'customers.addresses',
  'customers.shopkeepers',
  'identity.driver_credentials',
  'identity.staff_memberships',
  'platform.rls_probe',
  'tenancy.distributors',
] as const;
const S11B_TABLES = [
  'customers.shopkeepers',
  'identity.accounts',
  'identity.driver_credentials',
  'identity.otp_challenges',
  'identity.pending_session_denies',
  'identity.refresh_tokens',
  'identity.sessions',
  'identity.staff_memberships',
  'tenancy.distributors',
] as const;
const DIST_A = '11111111-1111-1111-1111-111111111111';
const DIST_B = '22222222-2222-2222-2222-222222222222';
const ROW_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ROW_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SK_A = 'aa111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SK_B = 'bb222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACC_DA_A = 'aa333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC_DA_B = 'bb333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACC_DR_A = 'aa444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC_DR_B = 'bb444444-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('RLS harness skeleton', () => {
  let deps: StartedPostgresRoles;
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let identityPool: pg.Pool;

  beforeAll(async () => {
    deps = await startPostgresWithRoles();
    ownerPool = new pg.Pool({ connectionString: deps.ownerUrl });
    appPool = new pg.Pool({ connectionString: deps.appUrl });
    identityPool = new pg.Pool({ connectionString: deps.identityUrl });
    attachPgTeardownGuard(ownerPool);
    attachPgTeardownGuard(appPool);
    attachPgTeardownGuard(identityPool);
    await ownerPool.query(`
      CREATE TABLE platform.rls_probe (
        id uuid PRIMARY KEY,
        distributor_id uuid NOT NULL
      );
      ALTER TABLE platform.rls_probe ENABLE ROW LEVEL SECURITY;
      ALTER TABLE platform.rls_probe FORCE ROW LEVEL SECURITY;
      CREATE POLICY rls_probe_tenant ON platform.rls_probe
        USING (distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid)
        WITH CHECK (distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid);
      GRANT SELECT, INSERT, UPDATE, DELETE ON platform.rls_probe TO vproject_app;
      INSERT INTO platform.rls_probe (id, distributor_id) VALUES
        ('${ROW_A}', '${DIST_A}'),
        ('${ROW_B}', '${DIST_B}');
    `);
    await seedDemoTenants({
      ownerUrl: deps.ownerUrl,
      appUrl: deps.appUrl,
      identityUrl: deps.identityUrl,
    });
    await ownerPool.query(
      `INSERT INTO tenancy.distributors (id, name, status, created_at) VALUES
         ($1, 'Harness D1', 'active', now()),
         ($2, 'Harness D2', 'active', now())`,
      [DIST_A, DIST_B],
    );
    await withTenant(appPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      await tx.client.query(
        `INSERT INTO customers.shopkeepers
           (id, account_id, phone, primary_distributor_id, status, created_at) VALUES
           ($1, $2, '+989111111111', $3, 'active', now()),
           ($4, $5, '+989222222222', $6, 'active', now())`,
        [SK_A, ACC_DA_A, DIST_A, SK_B, ACC_DA_B, DIST_B],
      );
    });
    await withTenant(identityPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      await tx.client.query(
        `INSERT INTO identity.accounts
           (id, typ, username_norm, status, session_version, must_change_password, created_at) VALUES
           ($1, 'staff', 'harness-da-a', 'active', 0, false, now()),
           ($2, 'staff', 'harness-da-b', 'active', 0, false, now()),
           ($3, 'driver', 'harness-dr-a', 'active', 0, false, now()),
           ($4, 'driver', 'harness-dr-b', 'active', 0, false, now())`,
        [ACC_DA_A, ACC_DA_B, ACC_DR_A, ACC_DR_B],
      );
      await tx.client.query(
        `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions) VALUES
           ($1, 'distributor_admin', $2, ARRAY['drivers.manage']::text[]),
           ($3, 'distributor_admin', $4, ARRAY['drivers.manage']::text[])`,
        [ACC_DA_A, DIST_A, ACC_DA_B, DIST_B],
      );
      await tx.client.query(
        `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash) VALUES
           ($1, $2, 'harness-hash'),
           ($3, $4, 'harness-hash')`,
        [ACC_DR_A, DIST_A, ACC_DR_B, DIST_B],
      );
    });
  }, 120_000);

  afterAll(async () => {
    await identityPool?.end();
    await appPool?.end();
    await ownerPool?.end();
    await deps?.postgres.stop();
  });

  it('creates the 12 module schemas', async () => {
    const result = await ownerPool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname`,
      [DB_SCHEMAS],
    );
    expect(result.rows.map((r) => r.nspname).sort()).toEqual([...DB_SCHEMAS].sort());
  });

  it('creates local DB roles with explicit least-privilege flags', async () => {
    const result = await ownerPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles
       WHERE rolname IN ('vproject_app', 'vproject_worker', 'vproject_migrator', 'vproject_identity')
       ORDER BY rolname`,
    );
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) {
      expect(row.rolsuper).toBe(false);
      expect(row.rolcreatedb).toBe(false);
      expect(row.rolcreaterole).toBe(false);
      expect(row.rolreplication).toBe(false);
    }
    const byName = Object.fromEntries(result.rows.map((r) => [r.rolname, r.rolbypassrls]));
    expect(byName['vproject_app']).toBe(false);
    expect(byName['vproject_worker']).toBe(false);
    expect(byName['vproject_identity']).toBe(false);
  });

  it('TEN-01: opens the request pool as vproject_app with NOBYPASSRLS', async () => {
    const who = await appPool.query<{ current_user: string }>(`SELECT current_user`);
    expect(who.rows[0]?.current_user).toBe('vproject_app');
    const flag = await appPool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(flag.rows[0]?.rolbypassrls).toBe(false);
    await expect(assertRuntimeDbRole(appPool, 'vproject_app')).resolves.toBeUndefined();
  });

  it('ROLE-GUARD-01: refuses to start as a superuser or the migrator', async () => {
    await expect(assertRuntimeDbRole(ownerPool, 'vproject_app')).rejects.toThrow(/superuser/);
    const migratorPool = new pg.Pool({
      connectionString: databaseUrlAs(deps.ownerUrl, 'vproject_migrator', TEST_ROLE_PASSWORD),
    });
    try {
      await expect(assertRuntimeDbRole(migratorPool, 'vproject_app')).rejects.toThrow(/migrator/);
    } finally {
      await migratorPool.end();
    }
  });

  it('ROLE-GUARD-01: identity pool is vproject_identity with NOBYPASSRLS', async () => {
    const who = await identityPool.query<{ current_user: string }>(`SELECT current_user`);
    expect(who.rows[0]?.current_user).toBe('vproject_identity');
    await expect(assertRuntimeDbRole(identityPool, 'vproject_identity')).resolves.toBeUndefined();
  });

  it('ROLE-GUARD-01: refuses swapped app and identity pools', async () => {
    await expect(assertRuntimeDbRole(appPool, 'vproject_identity')).rejects.toThrow(
      /must connect as vproject_identity, got vproject_app/,
    );
    await expect(assertRuntimeDbRole(identityPool, 'vproject_app')).rejects.toThrow(
      /must connect as vproject_app, got vproject_identity/,
    );
  });

  it('TEN-01: grants vproject_app nothing on identity and leaves schemas owned by the migrator', async () => {
    const usage = await ownerPool.query<{ allowed: boolean }>(
      `SELECT has_schema_privilege('vproject_app', 'identity', 'USAGE') AS allowed`,
    );
    expect(usage.rows[0]?.allowed).toBe(false);

    const tableGrants = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants
       WHERE grantee = 'vproject_app' AND table_schema = 'identity'`,
    );
    expect(tableGrants.rows[0]?.c).toBe('0');

    const owners = await ownerPool.query<{ nspname: string; owner: string }>(
      `SELECT n.nspname, r.rolname AS owner
       FROM pg_namespace n
       JOIN pg_roles r ON r.oid = n.nspowner
       WHERE n.nspname = ANY($1::text[])
       ORDER BY n.nspname`,
      [DB_SCHEMAS],
    );
    expect(owners.rows).toHaveLength(DB_SCHEMAS.length);
    for (const row of owners.rows) {
      expect(row.owner).toBe('vproject_migrator');
    }
  });

  it('TEN-01-OWN: vproject_app and vproject_worker own no tables', async () => {
    const owned = await ownerPool.query<{
      schemaname: string;
      tablename: string;
      tableowner: string;
    }>(
      `SELECT schemaname, tablename, tableowner FROM pg_tables
       WHERE tableowner IN ('vproject_app', 'vproject_worker')
       ORDER BY 1, 2`,
    );
    expect(owned.rows).toEqual([]);
  });

  it('TEN-02-GATE: tenant-schema tables have FORCE RLS, a policy, and are listed in the harness', async () => {
    const found = await ownerPool.query<{
      qualified: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `SELECT n.nspname || '.' || c.relname AS qualified,
              c.relrowsecurity,
              c.relforcerowsecurity,
              (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1::text[])
         AND c.relkind IN ('r', 'p')
       ORDER BY 1`,
      [GATE_SCHEMAS],
    );
    const unscoped = new Set<string>(IDENTITY_UNSCOPED);
    const tenantTables = found.rows.filter(
      (row) => !RLS_EXEMPT_TABLES.has(row.qualified) && !unscoped.has(row.qualified),
    );
    expect(tenantTables.map((row) => row.qualified)).toEqual([...HARNESS_TENANT_TABLES].sort());
    const identityUnscoped = found.rows.filter((row) => unscoped.has(row.qualified));
    expect(identityUnscoped.map((row) => row.qualified)).toEqual([...IDENTITY_UNSCOPED].sort());
    for (const row of [...tenantTables, ...identityUnscoped]) {
      expect(row.relrowsecurity, `${row.qualified} must ENABLE RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.qualified} must FORCE RLS`).toBe(true);
      expect(Number(row.policies), `${row.qualified} must have ≥1 policy`).toBeGreaterThan(0);
    }
  });

  it('TEN-03: does not leak tenant GUCs after commit on a pooled connection', async () => {
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const inside = await tx.client.query<{ current_setting: string }>(
        `SELECT current_setting('app.distributor_id', true) AS current_setting`,
      );
      expect(inside.rows[0]?.current_setting).toBe(DIST_A);
    });
    const outside = await appPool.query<{ current_setting: string | null }>(
      `SELECT current_setting('app.distributor_id', true) AS current_setting`,
    );
    expect(outside.rows[0]?.current_setting ?? '').toBe('');
  });

  it('TEN-02-S11B: S-11b tables have ENABLE+FORCE RLS and a policy', async () => {
    const found = await ownerPool.query<{
      qualified: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `SELECT n.nspname || '.' || c.relname AS qualified,
              c.relrowsecurity,
              c.relforcerowsecurity,
              (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname || '.' || c.relname = ANY($1::text[])
       ORDER BY 1`,
      [S11B_TABLES],
    );
    expect(found.rows.map((row) => row.qualified)).toEqual([...S11B_TABLES].sort());
    for (const row of found.rows) {
      expect(row.relrowsecurity, `${row.qualified} must ENABLE RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.qualified} must FORCE RLS`).toBe(true);
      expect(Number(row.policies), `${row.qualified} must have ≥1 policy`).toBeGreaterThan(0);
    }
  });

  it('TEN-04: unset distributor GUC yields 0 rows, not an error, and cannot disable RLS', async () => {
    const client = await appPool.connect();
    try {
      const unset = await client.query<{ current_setting: string | null }>(
        `SELECT current_setting('app.distributor_id', true) AS current_setting`,
      );
      expect(unset.rows[0]?.current_setting ?? '').toBe('');
      const none = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM platform.rls_probe`,
      );
      expect(none.rows[0]?.c).toBe('0');
      await client.query(`SET row_security = off`);
      await expect(client.query(`SELECT count(*) FROM platform.rls_probe`)).rejects.toThrow(
        /row-level security/i,
      );
    } finally {
      await client.query(`RESET row_security`).catch(() => undefined);
      client.release();
    }
  });

  it('TENANT-01: scopes rows to the tenant and hides the other tenant', async () => {
    const scoped = parseScopeDistributorHeader(DIST_A);
    expect(scoped).toBe(DIST_A);
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const rows = await tx.client.query<{ distributor_id: string }>(
        `SELECT distributor_id::text FROM platform.rls_probe`,
      );
      expect(rows.rows.map((r) => r.distributor_id)).toEqual([DIST_A]);
    });
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_B }, async (tx) => {
      const rows = await tx.client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM platform.rls_probe`,
      );
      expect(rows.rows[0]?.c).toBe('1');
    });
  });

  it('TENANT-W-01: cross-tenant UPDATE and DELETE affect 0 rows', async () => {
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const updated = await tx.client.query(`UPDATE platform.rls_probe SET id = id WHERE id = $1`, [
        ROW_B,
      ]);
      expect(updated.rowCount).toBe(0);
      const deleted = await tx.client.query(`DELETE FROM platform.rls_probe WHERE id = $1`, [
        ROW_B,
      ]);
      expect(deleted.rowCount).toBe(0);
    });
    const stillThere = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.rls_probe WHERE id = $1 AND distributor_id = $2`,
      [ROW_B, DIST_B],
    );
    expect(stillThere.rows[0]?.c).toBe('1');
  });

  it('TENANT-W-01: INSERT for another tenant fails WITH CHECK', async () => {
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(
          `INSERT INTO platform.rls_probe (id, distributor_id) VALUES ($1, $2)`,
          [randomUUID(), DIST_B],
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
    const extras = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.rls_probe WHERE distributor_id = $1`,
      [DIST_B],
    );
    expect(extras.rows[0]?.c).toBe('1');
  });

  it('seeds 2 distributors, 1 SA, 1 DA per distributor with drivers.manage, 2 drivers each', async () => {
    const distributors = await ownerPool.query<{ id: string }>(
      `SELECT id::text FROM tenancy.distributors WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [SEED.distributors.map((d) => d.id)],
    );
    expect(distributors.rows.map((r) => r.id)).toEqual(SEED.distributors.map((d) => d.id).sort());

    const sa = await ownerPool.query<{ username_norm: string; role: string }>(
      `SELECT a.username_norm, m.role
       FROM identity.accounts a
       JOIN identity.staff_memberships m ON m.account_id = a.id
       WHERE a.id = $1`,
      [SEED.sa.id],
    );
    expect(sa.rows[0]).toEqual({ username_norm: 'sa', role: 'super_admin' });

    const das = await ownerPool.query<{ username_norm: string; permissions: string[] }>(
      `SELECT a.username_norm, m.permissions
       FROM identity.accounts a
       JOIN identity.staff_memberships m ON m.account_id = a.id
       WHERE a.id = ANY($1::uuid[])
       ORDER BY a.username_norm`,
      [SEED.das.map((d) => d.id)],
    );
    expect(das.rows).toHaveLength(2);
    for (const row of das.rows) {
      expect(row.permissions).toEqual(['drivers.manage']);
    }

    const drivers = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.driver_credentials
       WHERE account_id = ANY($1::uuid[])`,
      [SEED.drivers.map((d) => d.id)],
    );
    expect(drivers.rows[0]?.c).toBe('4');
  });

  it('TENANT-01-S11B: the app renames only its own distributor; status, INSERT and DELETE stay denied', async () => {
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const rows = await tx.client.query<{ id: string }>(
        `SELECT id::text FROM tenancy.distributors WHERE id IN ($1, $2) ORDER BY id`,
        [DIST_A, DIST_B],
      );
      expect(rows.rows.map((r) => r.id)).toEqual([DIST_A]);
    });
    // B27: the column-level grant allows `name` on the caller's own row only.
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const renamed = await tx.client.query(
        `UPDATE tenancy.distributors SET name = 'Harness D1 renamed' WHERE id = $1`,
        [DIST_A],
      );
      expect(renamed.rowCount).toBe(1);
      const foreign = await tx.client.query(
        `UPDATE tenancy.distributors SET name = 'hacked' WHERE id = $1`,
        [DIST_B],
      );
      expect(foreign.rowCount).toBe(0);
    });
    const renamed = await ownerPool.query<{ name: string }>(
      `SELECT name FROM tenancy.distributors WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[DIST_A, DIST_B].sort()],
    );
    expect(renamed.rows.map((row) => row.name)).toEqual(['Harness D1 renamed', 'Harness D2']);
    // B27 is profile-only: status never moves through the app role.
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(`UPDATE tenancy.distributors SET status = 'inactive' WHERE id = $1`, [
          DIST_A,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(
          `INSERT INTO tenancy.distributors (id, name, status, created_at)
           VALUES ($1, 'other', 'active', now())`,
          [randomUUID()],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(`DELETE FROM tenancy.distributors WHERE id = $1`, [DIST_A]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('TENANT-01-S11B: customers.shopkeepers is staff-scoped to their distributor, plus owner and platform (B33/B35/B36/A8)', async () => {
    // B33 (0014) adds shopkeepers_staff_read: a staff token sees the shops of its own distributor.
    const supplyA = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM customers.shopkeepers WHERE primary_distributor_id = $1`,
      [DIST_A],
    );
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const visible = await tx.client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM customers.shopkeepers`,
      );
      expect(visible.rows[0]?.c).toBe(supplyA.rows[0]?.c);
      const rows = await tx.client.query<{ id: string }>(
        `SELECT id::text FROM customers.shopkeepers WHERE id IN ($1, $2) ORDER BY id`,
        [SK_A, SK_B],
      );
      expect(rows.rows.map((r) => r.id)).toEqual([SK_A]);
      // B35 (`shopkeepers_staff_update`) lets staff flip the status of its own distributor's shops…
      const updated = await tx.client.query(
        `UPDATE customers.shopkeepers SET status = 'blocked' WHERE id = ANY($1::uuid[])`,
        [[SK_A, SK_B]],
      );
      expect(updated.rowCount).toBe(1);
      // …and 0015 grants that one column only, so no other field moves through the app role.
      await expect(
        tx.client.query(`UPDATE customers.shopkeepers SET phone = phone WHERE id = $1`, [SK_A]),
      ).rejects.toThrow(/permission denied/i);
    });
    // B36 (0016) adds `primary_distributor_id` to that grant. Naming the caller's own distributor is
    // allowed and changes nothing; naming another tenant's is stopped by the same policy's WITH CHECK,
    // so the widened column never becomes a way to hand a shop to someone else. Each probe takes its
    // own transaction because a policy rejection aborts the current one.
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const same = await tx.client.query(
        `UPDATE customers.shopkeepers SET primary_distributor_id = $1 WHERE id = $2`,
        [DIST_A, SK_A],
      );
      expect(same.rowCount).toBe(1);
    });
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(
          `UPDATE customers.shopkeepers SET primary_distributor_id = $1 WHERE id = $2`,
          [DIST_B, SK_A],
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
    await withTenant(appPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      const moved = await tx.client.query(
        `UPDATE customers.shopkeepers SET primary_distributor_id = $1 WHERE id = $2`,
        [DIST_B, SK_A],
      );
      expect(moved.rowCount).toBe(1);
      const restored = await tx.client.query(
        `UPDATE customers.shopkeepers SET primary_distributor_id = $1 WHERE id = $2`,
        [DIST_A, SK_A],
      );
      expect(restored.rowCount).toBe(1);
    });
    await withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
      const self = await tx.client.query<{ id: string }>(
        `SELECT id::text FROM customers.shopkeepers WHERE id IN ($1, $2)`,
        [SK_A, SK_B],
      );
      expect(self.rows.map((r) => r.id)).toEqual([SK_A]);
    });
    // A8 (0017) adds `name` to the app role's columns, and the same policy that hides B also keeps
    // its name unwritten: the row is filtered by USING, so the update touches zero rows.
    await withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
      const own = await tx.client.query(
        `UPDATE customers.shopkeepers SET name = 'فروشگاه A' WHERE id = $1`,
        [SK_A],
      );
      expect(own.rowCount).toBe(1);
      const foreign = await tx.client.query(
        `UPDATE customers.shopkeepers SET name = 'hacked' WHERE id = $1`,
        [SK_B],
      );
      expect(foreign.rowCount).toBe(0);
    });
    const named = await ownerPool.query<{ id: string; name: string | null }>(
      `SELECT id::text, name FROM customers.shopkeepers WHERE id IN ($1, $2) ORDER BY id`,
      [SK_A, SK_B],
    );
    expect(named.rows[0]).toEqual({ id: SK_A, name: 'فروشگاه A' });
    expect(named.rows[1]?.name).not.toBe('hacked');
    await withTenant(appPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      const all = await tx.client.query<{ id: string }>(
        `SELECT id::text FROM customers.shopkeepers WHERE id IN ($1, $2) ORDER BY id`,
        [SK_A, SK_B],
      );
      expect(all.rows.map((r) => r.id)).toEqual([SK_A, SK_B].sort());
    });
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(
          `INSERT INTO customers.shopkeepers
             (id, account_id, phone, primary_distributor_id, status, created_at)
           VALUES ($1, $2, '+989000000000', $3, 'active', now())`,
          [randomUUID(), randomUUID(), DIST_A],
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(`DELETE FROM customers.shopkeepers WHERE id = $1`, [SK_A]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('customers.shopkeepers.account_id is UNIQUE', async () => {
    await expect(
      withTenant(appPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
        await tx.client.query(
          `INSERT INTO customers.shopkeepers
             (id, account_id, phone, primary_distributor_id, status, created_at)
           VALUES ($1, $2, '+989000000001', $3, 'active', now())`,
          [randomUUID(), ACC_DA_A, DIST_A],
        );
      }),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('TENANT-01-S11B: customers.addresses is own-shop only for read, insert and update (A9/A10/A11/A13)', async () => {
    const addrA = randomUUID();
    const addrB = randomUUID();
    await ownerPool.query(
      `INSERT INTO customers.addresses
         (id, shopkeeper_id, title, full_address, plaque, unit, tag, branch_name,
          city_name, lat, lng, street_label, created_at)
       VALUES ($1, $2, 'Harness A', 'Full A', '1', '1', 'store', NULL, 'Tehran', 35.7, 51.4, 'Street A', now()),
              ($3, $4, 'Harness B', 'Full B', '2', '2', NULL, 'Branch B', 'Tehran', 35.7, 51.4, 'Street B', now())`,
      [addrA, SK_A, addrB, SK_B],
    );
    await withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
      const visible = await tx.client.query<{ id: string }>(
        `SELECT id::text FROM customers.addresses WHERE id IN ($1, $2) ORDER BY id`,
        [addrA, addrB],
      );
      expect(visible.rows.map((r) => r.id)).toEqual([addrA]);
      // A10 inserts through `addresses_tenant`, and 0018 grants only that one column of the shop.
      const own = await tx.client.query(
        `INSERT INTO customers.addresses
           (id, shopkeeper_id, title, full_address, plaque, unit, tag, branch_name,
            city_name, lat, lng, street_label, created_at)
         VALUES ($1, $2, 'Own', 'Full own', '', '', NULL, NULL, 'Tehran', 35.7, 51.4, '', now())`,
        [randomUUID(), SK_A],
      );
      expect(own.rowCount).toBe(1);
      const pointed = await tx.client.query(
        `UPDATE customers.shopkeepers SET default_address_id = $2 WHERE id = $1`,
        [SK_A, addrA],
      );
      expect(pointed.rowCount).toBe(1);
    });
    // No tenant GUC means no rows at all, never a cross-shop read.
    const none = await appPool.query<{ id: string }>(`SELECT id::text FROM customers.addresses`);
    expect(none.rows).toHaveLength(0);
    // Naming another shop in the INSERT is refused by WITH CHECK; each probe needs its own
    // transaction because a policy rejection aborts the current one.
    await expect(
      withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
        await tx.client.query(
          `INSERT INTO customers.addresses
             (id, shopkeeper_id, title, full_address, plaque, unit, tag, branch_name,
              city_name, lat, lng, street_label, created_at)
           VALUES ($1, $2, 'Hacked', 'Full', '', '', NULL, NULL, 'Tehran', 35.7, 51.4, '', now())`,
          [randomUUID(), SK_B],
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
    // A11/A13 (0019): the app role may rewrite its own row and soft-delete it.
    await withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
      const own = await tx.client.query(
        `UPDATE customers.addresses SET title = 'Harness A2', deleted_at = now() WHERE id = $1`,
        [addrA],
      );
      expect(own.rowCount).toBe(1);
      // A foreign row is invisible to the same UPDATE, so it is 0 rows rather than a write.
      const foreign = await tx.client.query(
        `UPDATE customers.addresses SET title = 'Hijacked' WHERE id = $1`,
        [addrB],
      );
      expect(foreign.rowCount).toBe(0);
    });
    const untouched = await ownerPool.query<{ title: string; deleted_at: Date | null }>(
      `SELECT title, deleted_at FROM customers.addresses WHERE id = $1`,
      [addrB],
    );
    expect(untouched.rows[0]).toMatchObject({ title: 'Harness B', deleted_at: null });
    // `shopkeeper_id` is not in the grant, so an address can never change owner.
    await expect(
      withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
        await tx.client.query(`UPDATE customers.addresses SET shopkeeper_id = $2 WHERE id = $1`, [
          addrA,
          SK_B,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
    // A13 is a soft delete; DELETE itself stays out of the app role's reach.
    await expect(
      withTenant(appPool, { subjectType: 'shopkeeper', shopkeeperId: SK_A }, async (tx) => {
        await tx.client.query(`DELETE FROM customers.addresses WHERE id = $1`, [addrA]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('TENANT-01-S11B: identity.driver_credentials is tenant-scoped for read and write', async () => {
    await withTenant(identityPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const rows = await tx.client.query<{ account_id: string }>(
        `SELECT account_id::text FROM identity.driver_credentials
         WHERE account_id IN ($1, $2) ORDER BY account_id`,
        [ACC_DR_A, ACC_DR_B],
      );
      expect(rows.rows.map((r) => r.account_id)).toEqual([ACC_DR_A]);
      const updated = await tx.client.query(
        `UPDATE identity.driver_credentials SET password_hash = password_hash WHERE account_id = $1`,
        [ACC_DR_B],
      );
      expect(updated.rowCount).toBe(0);
    });
    const extraAccount = randomUUID();
    await withTenant(identityPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      await tx.client.query(
        `INSERT INTO identity.accounts
           (id, typ, username_norm, status, session_version, must_change_password, created_at)
         VALUES ($1, 'driver', $2, 'active', 0, false, now())`,
        [extraAccount, `x-${extraAccount.slice(0, 8)}`],
      );
    });
    await expect(
      withTenant(identityPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(
          `INSERT INTO identity.driver_credentials (account_id, distributor_id, password_hash)
           VALUES ($1, $2, 'x')`,
          [extraAccount, DIST_B],
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
  });

  it('TENANT-01-S11B: identity.staff_memberships is tenant-scoped for read and write', async () => {
    await withTenant(identityPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
      const rows = await tx.client.query<{ account_id: string }>(
        `SELECT account_id::text FROM identity.staff_memberships
         WHERE account_id IN ($1, $2) ORDER BY account_id`,
        [ACC_DA_A, ACC_DA_B],
      );
      expect(rows.rows.map((r) => r.account_id)).toEqual([ACC_DA_A]);
      const updated = await tx.client.query(
        `UPDATE identity.staff_memberships SET role = role WHERE account_id = $1`,
        [ACC_DA_B],
      );
      expect(updated.rowCount).toBe(0);
    });
    const extraStaff = randomUUID();
    await withTenant(identityPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
      await tx.client.query(
        `INSERT INTO identity.accounts
           (id, typ, username_norm, status, session_version, must_change_password, created_at)
         VALUES ($1, 'staff', $2, 'active', 0, false, now())`,
        [extraStaff, `s-${extraStaff.slice(0, 8)}`],
      );
    });
    await expect(
      withTenant(identityPool, { subjectType: 'staff', distributorId: DIST_A }, async (tx) => {
        await tx.client.query(
          `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
           VALUES ($1, 'distributor_admin', $2, ARRAY['drivers.manage']::text[])`,
          [extraStaff, DIST_B],
        );
      }),
    ).rejects.toThrow(/row-level security policy/i);
  });

  it('identity can INSERT platform.audit_log but cannot UPDATE or DELETE it', async () => {
    const auditId = randomUUID();
    await identityPool.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'system', 'identity', 'identity', NULL,
         'login', 'account', $2, '{}'::jsonb, NULL)`,
      [auditId, ACC_DR_A],
    );
    const inserted = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.audit_log WHERE id = $1`,
      [auditId],
    );
    expect(inserted.rows[0]?.c).toBe('1');
    await expect(
      identityPool.query(`UPDATE platform.audit_log SET action = 'tamper' WHERE id = $1`, [
        auditId,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      identityPool.query(`DELETE FROM platform.audit_log WHERE id = $1`, [auditId]),
    ).rejects.toThrow(/permission denied/i);
    const still = await ownerPool.query<{ action: string }>(
      `SELECT action FROM platform.audit_log WHERE id = $1`,
      [auditId],
    );
    expect(still.rows[0]?.action).toBe('login');
  });

  it('identity can INSERT platform.outbox_events but cannot UPDATE or DELETE it', async () => {
    const eventId = randomUUID();
    await identityPool.query(
      `INSERT INTO platform.outbox_events (
         id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at
       ) VALUES ($1, 'identity.sessions_revoked', 1, 'session', $2, '{}'::jsonb, now())`,
      [eventId, ACC_DR_A],
    );
    await expect(
      identityPool.query(`UPDATE platform.outbox_events SET attempts = 1 WHERE id = $1`, [eventId]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      identityPool.query(`DELETE FROM platform.outbox_events WHERE id = $1`, [eventId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('lookup_driver_login returns credentials without is_platform', async () => {
    const none = await identityPool.query(
      `SELECT count(*)::text AS c FROM identity.driver_credentials`,
    );
    expect(none.rows[0]?.c).toBe('0');
    const found = await identityPool.query<{
      account_id: string;
      distributor_id: string;
      password_hash: string;
      status: string;
    }>(`SELECT * FROM identity.lookup_driver_login($1)`, ['harness-dr-a']);
    expect(found.rows).toEqual([
      {
        account_id: ACC_DR_A,
        distributor_id: DIST_A,
        password_hash: 'harness-hash',
        status: 'active',
      },
    ]);
  });

  it('accounts.username_norm CHECK rejects mixed case', async () => {
    await expect(
      withTenant(identityPool, { subjectType: 'staff', isPlatform: true }, async (tx) => {
        await tx.client.query(
          `INSERT INTO identity.accounts
             (id, typ, username_norm, status, session_version, must_change_password, created_at)
           VALUES ($1, 'driver', 'NotLower', 'active', 0, false, now())`,
          [randomUUID()],
        );
      }),
    ).rejects.toThrow(/username_norm|check constraint/i);
  });

  it('identity cannot DELETE sessions or refresh_tokens', async () => {
    await expect(identityPool.query(`DELETE FROM identity.sessions`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(identityPool.query(`DELETE FROM identity.refresh_tokens`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('indexes family_id, account_id and sid for session revocation', async () => {
    const idx = await ownerPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'identity'
         AND indexname IN (
           'refresh_tokens_family_id_idx',
           'refresh_tokens_sid_idx',
           'sessions_account_id_idx',
           'sessions_family_id_idx'
         )
       ORDER BY 1`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual([
      'refresh_tokens_family_id_idx',
      'refresh_tokens_sid_idx',
      'sessions_account_id_idx',
      'sessions_family_id_idx',
    ]);
  });
});
