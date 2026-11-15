#!/usr/bin/env node
/**
 * Non-prod demo shopkeeper and distributor_admin. Refuses NODE_ENV=production.
 * Does not insert the real seed distributors, staff, or drivers.
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  DEMO_DISTRIBUTOR_ID,
  DEMO_SHOPKEEPER_ID,
  DEMO_SHOPKEEPER_PHONE,
  DEMO_STAFF_ID,
  DEMO_STAFF_PHONE,
} from '../src/modules/identity/domain/demoAccounts.js';
import { assertNonProdSeed, assertSeedDatabaseTarget, SeedError } from './seed.js';

export function assertDemoLoginSeed(env: NodeJS.ProcessEnv = process.env): void {
  assertNonProdSeed(env);
  if (env['DEMO_LOGIN_ENABLED'] !== 'true') {
    throw new SeedError('DEMO_LOGIN_ENABLED must be the exact string true');
  }
}

export async function seedDemoLogin(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO tenancy.distributors (id, name, status, created_at)
     VALUES ($1, 'Demo distributor', 'active', now())
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_DISTRIBUTOR_ID],
  );
  await pool.query(
    `INSERT INTO identity.accounts
       (id, typ, phone, status, session_version, must_change_password, is_demo, created_at)
     VALUES ($1, 'shopkeeper', $2, 'active', 0, false, true, now())
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_SHOPKEEPER_ID, DEMO_SHOPKEEPER_PHONE],
  );
  await pool.query(
    `INSERT INTO customers.shopkeepers
       (id, account_id, phone, primary_distributor_id, status, created_at)
     VALUES ($1, $1, $2, NULL, 'active', now())
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_SHOPKEEPER_ID, DEMO_SHOPKEEPER_PHONE],
  );
  await pool.query(
    `INSERT INTO identity.accounts
       (id, typ, phone, status, session_version, must_change_password, is_demo, created_at)
     VALUES ($1, 'staff', $2, 'active', 0, false, true, now())
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_STAFF_ID, DEMO_STAFF_PHONE],
  );
  await pool.query(
    `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
     VALUES ($1, 'distributor_admin', $2, ARRAY['dashboard.view']::text[])
     ON CONFLICT (account_id) DO NOTHING`,
    [DEMO_STAFF_ID, DEMO_DISTRIBUTOR_ID],
  );
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    assertDemoLoginSeed();
    const ownerUrl = process.env['MIGRATION_DATABASE_URL'];
    if (!ownerUrl) throw new SeedError('MIGRATION_DATABASE_URL is required');
    assertSeedDatabaseTarget(ownerUrl);
    const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
    try {
      await seedDemoLogin(pool);
    } finally {
      await pool.end();
    }
    process.stdout.write('demo seed applied\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
