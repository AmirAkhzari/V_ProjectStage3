import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';

/**
 * A7 response. `plan` and `subscriptionExpiresAt` have no backing column yet and are documented
 * placeholders (null) until a later schema slice. `name` is real since A8 (0017) and
 * `defaultAddressId` since A9/A10 (0018).
 */
export interface MyProfileView {
  user: { id: string; name: string | null; phone: string };
  defaultAddressId: string | null;
  plan: null;
  primaryDistributorId: string | null;
  subscriptionExpiresAt: null;
}

/** The columns both A7 and A8 read; one definition so the two answers cannot drift. */
export interface MyShopkeeperRow {
  id: string;
  phone: string;
  name: string | null;
  primary_distributor_id: string | null;
  default_address_id: string | null;
  status: string;
}

export const MY_SHOPKEEPER_SELECT = `SELECT id, phone, name, primary_distributor_id,
              default_address_id, status
         FROM customers.shopkeepers`;

export function toMyProfileView(row: MyShopkeeperRow): MyProfileView {
  return {
    user: { id: row.id, name: row.name ?? null, phone: row.phone },
    defaultAddressId: row.default_address_id ?? null,
    plan: null,
    primaryDistributorId: row.primary_distributor_id,
    subscriptionExpiresAt: null,
  };
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
    client.query<MyShopkeeperRow>(`${MY_SHOPKEEPER_SELECT} WHERE id = $1`, [tenant.shopkeeperId]),
  );
  const row = found.rows[0];
  if (!row || row.status !== 'active') return null;
  return toMyProfileView(row);
}
