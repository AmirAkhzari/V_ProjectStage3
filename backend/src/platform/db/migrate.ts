import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';
import { assertLocalRolesTarget } from './localRoles.js';
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

export async function runMigrations(
  databaseUrl: string,
  options?: { applyRoles?: boolean; nodeEnv?: string; rolePassword?: string },
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (options?.applyRoles === true) {
      assertLocalRolesTarget(databaseUrl, options.nodeEnv ?? process.env['NODE_ENV']);
      await applyRoles(client);
      if (options.rolePassword) {
        await provisionLocalRolePasswords(client, options.rolePassword);
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
  const env = z
    .object({
      MIGRATION_DATABASE_URL: z.url().optional(),
      DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    })
    .safeParse(process.env);
  if (!env.success) {
    process.stderr.write(`Invalid migration environment: ${z.prettifyError(env.error)}\n`);
    process.exit(1);
  }
  const rolePassword = applyRolesFlag ? process.env['LOCAL_ROLE_PASSWORD'] : undefined;
  await runMigrations(env.data.MIGRATION_DATABASE_URL ?? env.data.DATABASE_URL, {
    applyRoles: applyRolesFlag,
    ...(rolePassword ? { rolePassword } : {}),
  });
  process.stdout.write(
    applyRolesFlag ? 'migrations + local roles applied\n' : 'migrations applied\n',
  );
}
