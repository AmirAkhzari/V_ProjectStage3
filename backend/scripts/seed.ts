#!/usr/bin/env node
/**
 * Non-prod seed for S11b-1: 2 distributors, 1 SA, 1 DA per distributor
 * (`drivers.manage`), 2 drivers per distributor. Password hashes are placeholders
 * until S11b-2 argon2id. Distributor rows are written via the owner/migrator URL
 * (app has SELECT only on tenancy.distributors).
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertLocalRolesTarget, LocalRolesError } from '../src/platform/db/localRoles.js';

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

/** Placeholder until S11b-2 argon2id (m=19456, t=2, p=1). */
export const PLACEHOLDER_PASSWORD_HASH = 'seed-placeholder-hash';

export const SEED = {
  distributors: [
    {
      id: '01000000-0000-4000-8000-000000000001',
      name: 'Distributor 1',
    },
    {
      id: '01000000-0000-4000-8000-000000000002',
      name: 'Distributor 2',
    },
  ],
  sa: {
    id: '02000000-0000-4000-8000-000000000001',
    usernameNorm: 'sa',
  },
  das: [
    {
      id: '02000000-0000-4000-8000-000000000011',
      usernameNorm: 'da1',
      distributorId: '01000000-0000-4000-8000-000000000001',
    },
    {
      id: '02000000-0000-4000-8000-000000000012',
      usernameNorm: 'da2',
      distributorId: '01000000-0000-4000-8000-000000000002',
    },
  ],
  drivers: [
    {
      id: '02000000-0000-4000-8000-000000000021',
      usernameNorm: 'driver1a',
      distributorId: '01000000-0000-4000-8000-000000000001',
    },
    {
      id: '02000000-0000-4000-8000-000000000022',
      usernameNorm: 'driver1b',
      distributorId: '01000000-0000-4000-8000-000000000001',
    },
    {
      id: '02000000-0000-4000-8000-000000000023',
      usernameNorm: 'driver2a',
      distributorId: '01000000-0000-4000-8000-000000000002',
    },
    {
      id: '02000000-0000-4000-8000-000000000024',
      usernameNorm: 'driver2b',
      distributorId: '01000000-0000-4000-8000-000000000002',
    },
  ],
} as const;

export function assertNonProdSeed(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] === 'production') {
    throw new SeedError('seed script must not run when NODE_ENV=production');
  }
  if (env['NODE_ENV'] !== 'development' && env['NODE_ENV'] !== 'test') {
    throw new SeedError('seed script requires NODE_ENV=development or NODE_ENV=test');
  }
}

/** Reuse local-roles host rules: loopback, or private only in test (AppSec 7-10). */
export function assertSeedDatabaseTarget(
  databaseUrl: string,
  nodeEnv: string | undefined = process.env['NODE_ENV'],
): void {
  try {
    assertLocalRolesTarget(databaseUrl, nodeEnv);
  } catch (error) {
    if (error instanceof LocalRolesError) {
      throw new SeedError(error.message.replace('local roles.sql', 'seed script'));
    }
    throw error;
  }
}

async function withPlatform(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.is_platform', 'true', true)`);
    await fn(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function seedDemoTenants(urls: {
  ownerUrl: string;
  appUrl: string;
  identityUrl: string;
}): Promise<void> {
  assertSeedDatabaseTarget(urls.ownerUrl);
  assertSeedDatabaseTarget(urls.appUrl);
  assertSeedDatabaseTarget(urls.identityUrl);

  const ownerPool = new pg.Pool({ connectionString: urls.ownerUrl, max: 2 });
  const identityPool = new pg.Pool({ connectionString: urls.identityUrl, max: 2 });
  try {
    for (const dist of SEED.distributors) {
      await ownerPool.query(
        `INSERT INTO tenancy.distributors (id, name, status, created_at)
         VALUES ($1, $2, 'active', now())
         ON CONFLICT (id) DO NOTHING`,
        [dist.id, dist.name],
      );
    }

    await withPlatform(identityPool, async (client) => {
      await client.query(
        `INSERT INTO identity.accounts
           (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
         VALUES ($1, 'staff', NULL, $2, 'active', 0, false, now())
         ON CONFLICT (id) DO NOTHING`,
        [SEED.sa.id, SEED.sa.usernameNorm],
      );
      await client.query(
        `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
         VALUES ($1, 'super_admin', NULL, ARRAY[]::text[])
         ON CONFLICT (account_id) DO NOTHING`,
        [SEED.sa.id],
      );

      for (const da of SEED.das) {
        await client.query(
          `INSERT INTO identity.accounts
             (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
           VALUES ($1, 'staff', NULL, $2, 'active', 0, false, now())
           ON CONFLICT (id) DO NOTHING`,
          [da.id, da.usernameNorm],
        );
        await client.query(
          `INSERT INTO identity.staff_memberships (account_id, role, distributor_id, permissions)
           VALUES ($1, 'distributor_admin', $2, ARRAY['drivers.manage']::text[])
           ON CONFLICT (account_id) DO NOTHING`,
          [da.id, da.distributorId],
        );
      }

      for (const driver of SEED.drivers) {
        await client.query(
          `INSERT INTO identity.accounts
             (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
           VALUES ($1, 'driver', NULL, $2, 'active', 0, true, now())
           ON CONFLICT (id) DO NOTHING`,
          [driver.id, driver.usernameNorm],
        );
        await client.query(
          `INSERT INTO identity.driver_credentials
             (account_id, distributor_id, password_hash, temp_expires_at)
           VALUES ($1, $2, $3, now() + interval '72 hours')
           ON CONFLICT (account_id) DO NOTHING`,
          [driver.id, driver.distributorId, PLACEHOLDER_PASSWORD_HASH],
        );
      }
    });
  } finally {
    await Promise.all([ownerPool.end(), identityPool.end()]);
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    assertNonProdSeed();
    const ownerUrl = process.env['MIGRATION_DATABASE_URL'];
    const appUrl = process.env['DATABASE_URL_APP'];
    const identityUrl = process.env['DATABASE_URL_IDENTITY'];
    if (!ownerUrl || !appUrl || !identityUrl) {
      throw new SeedError(
        'MIGRATION_DATABASE_URL, DATABASE_URL_APP and DATABASE_URL_IDENTITY are required',
      );
    }
    assertSeedDatabaseTarget(ownerUrl);
    assertSeedDatabaseTarget(appUrl);
    assertSeedDatabaseTarget(identityUrl);
    await seedDemoTenants({ ownerUrl, appUrl, identityUrl });
    process.stdout.write('seed applied (2 distributors, 1 SA, 2 DA, 4 drivers)\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
