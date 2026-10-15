import type pg from 'pg';

export const DB_ROLES = ['app', 'worker', 'identity', 'migrator'] as const;
export type DbRole = (typeof DB_ROLES)[number];

export const DB_ROLE_NAMES = {
  app: 'vproject_app',
  worker: 'vproject_worker',
  identity: 'vproject_identity',
  migrator: 'vproject_migrator',
} as const satisfies Record<DbRole, string>;

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Local-only LOGIN passwords are injected at runtime, never stored in SQL (AppSec H-1). */
export async function provisionLocalRolePasswords(
  client: pg.Client | pg.Pool,
  password: string,
): Promise<void> {
  const quoted = sqlLiteral(password);
  for (const role of Object.values(DB_ROLE_NAMES)) {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${quoted}`);
  }
}

export function databaseUrlAs(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}
