import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase;

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
  close(): Promise<void>;
}

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
