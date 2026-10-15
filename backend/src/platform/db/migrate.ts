import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { ConfigError, postgresRequiresTls } from '../config.js';
import { allowMissingRoles, assertLocalRolesTarget } from './localRoles.js';
import { provisionLocalRolePasswords } from './roles.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
export const ROLES_SQL_PATH = fileURLToPath(new URL('../../../db/roles.sql', import.meta.url));
export const LOCAL_GRANTS_SQL_PATH = fileURLToPath(
  new URL('../../../db/local-grants.sql', import.meta.url),
);

async function execSqlFile(client: pg.Client, path: string): Promise<void> {
  const sql = await readFile(path, 'utf8');
  await client.query(sql);
}

export async function applyRoles(
  client: pg.Client,
  rolesSqlPath: string = ROLES_SQL_PATH,
): Promise<void> {
  await execSqlFile(client, rolesSqlPath);
}

const FORBIDDEN_MIGRATE_USERS = new Set(['vproject_app', 'vproject_worker', 'vproject_identity']);

export function loadMigrateDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['MIGRATION_DATABASE_URL'];
  if (!url) {
    throw new ConfigError([
      { field: 'MIGRATION_DATABASE_URL', message: 'MIGRATION_DATABASE_URL is required' },
    ]);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError([{ field: 'MIGRATION_DATABASE_URL', message: 'must be a valid URL' }]);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new ConfigError([
      { field: 'MIGRATION_DATABASE_URL', message: 'must be a postgres:// URL' },
    ]);
  }
  const user = decodeURIComponent(parsed.username);
  if (FORBIDDEN_MIGRATE_USERS.has(user)) {
    throw new ConfigError([
      {
        field: 'MIGRATION_DATABASE_URL',
        message: 'must not use the app, worker, or identity role',
      },
    ]);
  }
  if (env['NODE_ENV'] === 'production' && !postgresRequiresTls(url)) {
    throw new ConfigError([
      {
        field: 'MIGRATION_DATABASE_URL',
        message:
          'production MIGRATION_DATABASE_URL must require TLS (sslmode=require|verify-ca|verify-full)',
      },
    ]);
  }
  return url;
}

export async function runMigrations(
  databaseUrl: string,
  options?: { applyRoles?: boolean; nodeEnv?: string; rolePassword?: string },
): Promise<void> {
  const nodeEnv = options?.nodeEnv ?? process.env['NODE_ENV'];
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (options?.applyRoles === true) {
      assertLocalRolesTarget(databaseUrl, nodeEnv);
      await applyRoles(client);
      if (options.rolePassword) {
        await provisionLocalRolePasswords(client, options.rolePassword);
      }
    }
    if (allowMissingRoles(databaseUrl, nodeEnv)) {
      await client.query(`SELECT set_config('vproject.allow_missing_roles', 'on', false)`);
    }
    if (nodeEnv === 'production') {
      const who = await client.query<{ current_user: string }>(`SELECT current_user`);
      if (who.rows[0]?.current_user !== 'vproject_migrator') {
        throw new Error('production migrate must connect as vproject_migrator');
      }
    }
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
    if (options?.applyRoles === true) {
      await execSqlFile(client, LOCAL_GRANTS_SQL_PATH);
    }
  } finally {
    await client.end();
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const applyRolesFlag = process.argv.includes('--apply-roles');
  try {
    const url = loadMigrateDatabaseUrl();
    const rolePassword = applyRolesFlag ? process.env['LOCAL_ROLE_PASSWORD'] : undefined;
    await runMigrations(url, {
      applyRoles: applyRolesFlag,
      ...(rolePassword ? { rolePassword } : {}),
    });
    process.stdout.write(
      applyRolesFlag ? 'migrations + local roles applied\n' : 'migrations applied\n',
    );
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
