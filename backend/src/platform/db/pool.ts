import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase;

export interface DbLog {
  error(bindings: Record<string, unknown>, message: string): void;
}

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
  close(): Promise<void>;
}

export function createDb(
  databaseUrl: string,
  options: { max?: number; log?: DbLog } = {},
): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: options.max ?? 10 });
  pool.on('error', (err: Error & { code?: string }) => {
    options.log?.error({ code: err.code }, 'postgres pool error');
  });
  const db = drizzle({ client: pool });
  return {
    pool,
    db,
    close: () => pool.end(),
  };
}
