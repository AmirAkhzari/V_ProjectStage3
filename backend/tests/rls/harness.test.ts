import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_SCHEMAS } from '../../src/platform/modules.js';
import { withTenant } from '../../src/platform/db/tenant.js';
import { parseScopeDistributorHeader } from '../../src/platform/http/scope.js';
import { assertRuntimeDbRole } from '../../src/platform/db/runtimeRole.js';
import { databaseUrlAs } from '../../src/platform/db/roles.js';
import {
  startPostgresWithRoles,
  TEST_ROLE_PASSWORD,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const INFRA_TABLES = ['outbox_events', 'inbox_processed', 'audit_log', 'idempotency_keys'];
/** Schemas whose business tables must ENABLE+FORCE RLS (identity is not tenant-scoped). */
const TENANT_SCHEMAS = DB_SCHEMAS.filter((schema) => schema !== 'identity');
const RLS_EXEMPT_TABLES = new Set(INFRA_TABLES.map((table) => `platform.${table}`));
/** Fail-closed: every non-exempt tenant-schema table must appear here. */
const HARNESS_TENANT_TABLES = ['platform.rls_probe'] as const;
const DIST_A = '11111111-1111-1111-1111-111111111111';
const DIST_B = '22222222-2222-2222-2222-222222222222';
const ROW_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ROW_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('RLS harness skeleton', () => {
  let deps: StartedPostgresRoles;
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;

  beforeAll(async () => {
    deps = await startPostgresWithRoles();
    ownerPool = new pg.Pool({ connectionString: deps.ownerUrl });
    appPool = new pg.Pool({ connectionString: deps.appUrl });
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
  }, 120_000);

  afterAll(async () => {
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
    await expect(assertRuntimeDbRole(appPool)).resolves.toBeUndefined();
  });

  it('refuses to start as a superuser or the migrator', async () => {
    await expect(assertRuntimeDbRole(ownerPool)).rejects.toThrow(/superuser/);
    const migratorPool = new pg.Pool({
      connectionString: databaseUrlAs(deps.ownerUrl, 'vproject_migrator', TEST_ROLE_PASSWORD),
    });
    try {
      await expect(assertRuntimeDbRole(migratorPool)).rejects.toThrow(/migrator/);
    } finally {
      await migratorPool.end();
    }
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

  it('TEN-01: vproject_app owns no tables', async () => {
    const owned = await ownerPool.query<{ schemaname: string; tablename: string }>(
      `SELECT schemaname, tablename FROM pg_tables WHERE tableowner = 'vproject_app' ORDER BY 1, 2`,
    );
    expect(owned.rows).toEqual([]);
  });

  it('TEN-02: tenant-schema tables have FORCE RLS and are listed in the harness', async () => {
    const found = await ownerPool.query<{
      qualified: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT n.nspname || '.' || c.relname AS qualified,
              c.relrowsecurity,
              c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1::text[])
         AND c.relkind IN ('r', 'p')
       ORDER BY 1`,
      [TENANT_SCHEMAS],
    );
    const tenantTables = found.rows.filter((row) => !RLS_EXEMPT_TABLES.has(row.qualified));
    expect(tenantTables.map((row) => row.qualified)).toEqual([...HARNESS_TENANT_TABLES].sort());
    for (const row of tenantTables) {
      expect(row.relrowsecurity, `${row.qualified} must ENABLE RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.qualified} must FORCE RLS`).toBe(true);
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

  it('keeps domain schemas free of tenant tables (platform infra only)', async () => {
    const result = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.tables
       WHERE table_schema = ANY($1::text[]) AND table_type = 'BASE TABLE'
         AND NOT (table_schema = 'platform' AND table_name = ANY($2::text[]))
         AND table_name <> 'rls_probe'`,
      [DB_SCHEMAS, INFRA_TABLES],
    );
    expect(result.rows[0]?.c).toBe('0');
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

  it('TENANT-01: cross-tenant UPDATE and DELETE affect 0 rows', async () => {
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

  it('TENANT-01: INSERT for another tenant fails WITH CHECK', async () => {
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
});
