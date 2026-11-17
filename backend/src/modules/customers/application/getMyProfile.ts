import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';

/**
 * A7 response. `name`, `defaultAddressId`, `plan` and `subscriptionExpiresAt` have no
 * backing column yet and are documented placeholders (null) until a later schema slice.
 */
export interface MyProfileView {
  user: { id: string; name: null; phone: string };
  defaultAddressId: null;
  plan: null;
  primaryDistributorId: string | null;
  subscriptionExpiresAt: null;
}

interface ShopkeeperRow {
  id: string;
  phone: string;
  primary_distributor_id: string | null;
  status: string;
}

/**
 * A7: identity comes from the session principal. The read runs inside `withTenant`, so RLS
 * scopes `customers.shopkeepers` by `app.shopkeeper_id` (SET LOCAL) rather than a WHERE alone.
 * A missing or non-active row is indistinguishable from absent (404 at the HTTP layer).
 */
export async function getMyProfile(
  pool: pg.Pool,
  tenant: TenantContext,
): Promise<MyProfileView | null> {
  if (!tenant.shopkeeperId) return null;
  const found = await withTenant(pool, tenant, ({ client }) =>
    client.query<ShopkeeperRow>(
      `SELECT id, phone, primary_distributor_id, status
         FROM customers.shopkeepers
        WHERE id = $1`,
      [tenant.shopkeeperId],
    ),
  );
  const row = found.rows[0];
  if (!row || row.status !== 'active') return null;
  return {
    user: { id: row.id, name: null, phone: row.phone },
    defaultAddressId: null,
    plan: null,
    primaryDistributorId: row.primary_distributor_id,
    subscriptionExpiresAt: null,
  };
}
