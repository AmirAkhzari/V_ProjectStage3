import type pg from 'pg';
import { DB_ROLE_NAMES } from './roles.js';

export class UnsafeDbRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDbRoleError';
  }
}

export interface RuntimeDbRoleRow {
  current_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

export type RuntimeDbRoleName = (typeof DB_ROLE_NAMES)[keyof typeof DB_ROLE_NAMES];

/** Runtime processes must not hold owner/migrator or BYPASSRLS credentials (Architect R2-2). */
export function inspectRuntimeDbRole(
  row: RuntimeDbRoleRow | undefined,
  expected?: RuntimeDbRoleName,
): void {
  if (!row) {
    throw new UnsafeDbRoleError('could not resolve current database role');
  }
  if (row.rolsuper) {
    throw new UnsafeDbRoleError('runtime must not connect as a superuser');
  }
  if (row.rolbypassrls) {
    throw new UnsafeDbRoleError('runtime must not connect as a BYPASSRLS role');
  }
  if (row.current_user === DB_ROLE_NAMES.migrator) {
    throw new UnsafeDbRoleError('runtime must not connect as the migrator');
  }
  if (expected && row.current_user !== expected) {
    throw new UnsafeDbRoleError(`runtime must connect as ${expected}, got ${row.current_user}`);
  }
}

export async function assertRuntimeDbRole(
  pool: Pick<pg.Pool, 'query'>,
  expected: RuntimeDbRoleName,
): Promise<void> {
  const result = await pool.query<RuntimeDbRoleRow>(
    `SELECT current_user, rolsuper, rolbypassrls
     FROM pg_roles
     WHERE rolname = current_user`,
  );
  inspectRuntimeDbRole(result.rows[0], expected);
}
