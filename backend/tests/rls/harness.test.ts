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
    await runMigrations(url);
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

  it('creates local DB roles with vproject_app NOBYPASSRLS', async () => {
    const result = await pool.query<{ rolname: string; rolbypassrls: boolean }>(
      `SELECT rolname, rolbypassrls FROM pg_roles
       WHERE rolname IN ('vproject_app', 'vproject_worker', 'vproject_migrator')
       ORDER BY rolname`,
    );
    const byName = Object.fromEntries(result.rows.map((r) => [r.rolname, r.rolbypassrls]));
    expect(byName['vproject_app']).toBe(false);
    expect(byName['vproject_worker']).toBe(false);
    expect(byName['vproject_migrator']).toBeDefined();
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
