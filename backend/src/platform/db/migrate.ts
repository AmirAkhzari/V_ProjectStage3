import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
export const ROLES_SQL_PATH = fileURLToPath(new URL('../../../db/roles.sql', import.meta.url));

export async function applyRoles(
  client: pg.Client,
  rolesSqlPath: string = ROLES_SQL_PATH,
): Promise<void> {
  const sql = await readFile(rolesSqlPath, 'utf8');
  await client.query(sql);
}

export async function runMigrations(
  databaseUrl: string,
  options?: { applyRoles?: boolean },
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (options?.applyRoles !== false) {
      await applyRoles(client);
    }
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
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
  await runMigrations(env.data.MIGRATION_DATABASE_URL ?? env.data.DATABASE_URL);
  process.stdout.write('migrations applied\n');
}
