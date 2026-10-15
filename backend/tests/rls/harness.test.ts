import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_SCHEMAS } from '../../src/platform/modules.js';
import { runMigrations } from '../../src/platform/db/migrate.js';
import { withTenant } from '../../src/platform/db/tenant.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * RLS harness skeleton (P0-E4-T5). There are no tenant tables in Foundation, so the harness:
 * 1. migrates 12 empty schemas from zero
 * 2. asserts the local roles exist
 * 3. asserts SET LOCAL GUCs do not leak across pooled connections
 * Cross-tenant policy cases are appended when domain tables are authorized.
 */
describe('RLS harness skeleton', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations(url, { applyRoles: true, nodeEnv: 'test' });
    pool = new pg.Pool({ connectionString: url });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('creates the 12 empty module schemas', async () => {
    const result = await pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname`,
      [DB_SCHEMAS],
    );
    expect(result.rows.map((r) => r.nspname).sort()).toEqual([...DB_SCHEMAS].sort());
  });

  it('creates local DB roles with explicit least-privilege flags', async () => {
    const result = await pool.query<{
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
    expect(byName['vproject_migrator']).toBeDefined();
  });

  it('grants vproject_app nothing on identity and leaves schemas owned by the migrator', async () => {
    const usage = await pool.query<{ allowed: boolean }>(
      `SELECT has_schema_privilege('vproject_app', 'identity', 'USAGE') AS allowed`,
    );
    expect(usage.rows[0]?.allowed).toBe(false);

    const tableGrants = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.role_table_grants
       WHERE grantee = 'vproject_app' AND table_schema = 'identity'`,
    );
    expect(tableGrants.rows[0]?.c).toBe('0');

    const owners = await pool.query<{ nspname: string; owner: string }>(
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

  it('does not leak tenant GUCs after commit on a pooled connection', async () => {
    await withTenant(
      pool,
      { subjectType: 'staff', distributorId: '11111111-1111-1111-1111-111111111111' },
      async (tx) => {
        const inside = await tx.client.query<{ current_setting: string }>(
          `SELECT current_setting('app.distributor_id', true) AS current_setting`,
        );
        expect(inside.rows[0]?.current_setting).toBe('11111111-1111-1111-1111-111111111111');
      },
    );
    const outside = await pool.query<{ current_setting: string | null }>(
      `SELECT current_setting('app.distributor_id', true) AS current_setting`,
    );
    expect(outside.rows[0]?.current_setting ?? '').toBe('');
  });

  it('enumerates zero tenant tables while schemas stay empty', async () => {
    const result = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.tables
       WHERE table_schema = ANY($1::text[]) AND table_type = 'BASE TABLE'`,
      [DB_SCHEMAS],
    );
    expect(result.rows[0]?.c).toBe('0');
  });
});
