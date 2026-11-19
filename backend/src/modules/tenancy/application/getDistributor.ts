import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';

export interface DistributorView {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

export interface DistributorRow {
  id: string;
  name: string;
  status: string;
  created_at: Date;
}

/** Shared by B25 and B27 so the read and the write answer with the same shape. */
export function toDistributorView(row: DistributorRow): DistributorView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * TEN-404-01: the read runs inside the caller's tenant GUCs, so RLS decides visibility.
 * A row outside the tenant is invisible and therefore indistinguishable from a missing one.
 */
export async function findDistributor(
  pool: pg.Pool,
  tenant: TenantContext,
  id: string,
): Promise<DistributorView | null> {
  const found = await withTenant(pool, tenant, ({ client }) =>
    client.query<DistributorRow>(
      `SELECT id, name, status, created_at FROM tenancy.distributors WHERE id = $1`,
      [id],
    ),
  );
  const row = found.rows[0];
  if (!row) return null;
  return toDistributorView(row);
}
