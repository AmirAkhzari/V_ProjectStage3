import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import {
  ADDRESS_SELECT,
  toAddressView,
  type AddressRow,
  type AddressView,
} from '../domain/address.js';

/**
 * A9: the shop's address book. Identity comes only from the session principal, and `withTenant` sets
 * `app.shopkeeper_id`, so FORCE RLS (`addresses_tenant`) is what scopes the rows. A missing or
 * non-active shopkeeper is the same 404 A7/A8 answer, so a blocked shop reads nothing here either.
 */
export async function listMyAddresses(
  pool: pg.Pool,
  tenant: TenantContext,
): Promise<AddressView[] | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{ status: string }>(
      `SELECT status FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const row = shop.rows[0];
    if (!row || row.status !== 'active') return null;
    // Newest first, on the same (created_at, id) order the index carries. A13 soft-deletes, so
    // `deleted_at` is what keeps a removed address out of the book.
    const found = await tx.client.query<AddressRow>(
      `${ADDRESS_SELECT} WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
    );
    return found.rows.map(toAddressView);
  });
}
