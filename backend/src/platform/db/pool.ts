import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config.js';

export type Database = NodePgDatabase;

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
  close(): Promise<void>;
}

export type RuntimeDbRole = 'app' | 'worker' | 'identity';

export function createDb(databaseUrl: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: options.max ?? 10 });
  // An idle-client error must not crash the process; the health check surfaces DB outages.
  pool.on('error', () => {});
  const db = drizzle({ client: pool });
  return {
    pool,
    db,
    close: () => pool.end(),
  };
}

/** One pool per DB role (Architect B-2). Never share the migrator/owner URL with the request path. */
export function createRoleDb(
  config: Pick<Config, 'DATABASE_URL_APP' | 'DATABASE_URL_WORKER' | 'DATABASE_URL_IDENTITY'>,
  role: RuntimeDbRole,
  options: { max?: number } = {},
): DbHandle {
  const urls: Record<RuntimeDbRole, string> = {
    app: config.DATABASE_URL_APP,
    worker: config.DATABASE_URL_WORKER,
    identity: config.DATABASE_URL_IDENTITY,
  };
  return createDb(urls[role], options);
}
