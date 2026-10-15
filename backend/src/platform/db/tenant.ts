import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

/**
 * Session variables for RLS (§3.4), applied with `set_config(name, value, true)` (= SET LOCAL),
 * so they never outlive the transaction on a pooled connection.
 * Skeleton (P0-E4-T3): GUC names and their sources follow the architecture document; how they are
 * populated from auth claims is gated by DL-13 and not implemented here.
 */
export interface TenantContext {
  subjectType: 'shopkeeper' | 'staff' | 'driver' | 'system';
  shopkeeperId?: string;
  distributorId?: string;
  driverId?: string;
  catalogScope?: 'all' | 'primary';
  primaryDistributorId?: string;
  isPlatform?: boolean;
}

export const TENANT_GUCS = {
  subjectType: 'app.subject_type',
  shopkeeperId: 'app.shopkeeper_id',
  distributorId: 'app.distributor_id',
  driverId: 'app.driver_id',
  catalogScope: 'app.catalog_scope',
  primaryDistributorId: 'app.primary_distributor_id',
  isPlatform: 'app.is_platform',
} as const satisfies Record<keyof TenantContext, string>;

export interface TenantTx {
  client: pg.PoolClient;
  db: NodePgDatabase;
}

export function tenantSettings(ctx: TenantContext): [string, string][] {
  return (Object.keys(TENANT_GUCS) as (keyof TenantContext)[])
    .filter((key) => ctx[key] !== undefined)
    .map((key) => [TENANT_GUCS[key], String(ctx[key])]);
}

export async function withTenant<T>(
  pool: pg.Pool,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [name, value] of tenantSettings(ctx)) {
      await client.query('SELECT set_config($1, $2, true)', [name, value]);
    }
    const result = await fn({ client, db: drizzle({ client }) });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
