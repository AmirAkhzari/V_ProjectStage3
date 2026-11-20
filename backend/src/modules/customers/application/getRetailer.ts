import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import {
  RETAILER_VIEW_SELECT,
  toRetailerView,
  type RetailerRow,
  type RetailerView,
} from './listRetailers.js';

/**
 * B34: one shopkeeper, read through the same RLS visibility as B33 (`shopkeepers_staff_read` for a
 * staff token in the shop's distributor, every row for the platform scope). A row the token may not
 * see is therefore the same 404 as a row that does not exist, so the path never reveals whether
 * another tenant owns that id.
 *
 * The contract asks for detail *and addresses*, but `customers` has no address table yet (profile /
 * membership slices), so the detail is exactly the B33 item view rather than invented placeholders.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` for anything that cannot be a row id, which the route answers with the uniform 404. */
export function readRetailerId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

export async function findRetailer(
  pool: pg.Pool,
  tenant: TenantContext,
  id: string,
): Promise<RetailerView | null> {
  const found = await withTenant(pool, tenant, ({ client }) =>
    client.query<RetailerRow>(
      `${RETAILER_VIEW_SELECT}
        WHERE s.id = $1`,
      [id],
    ),
  );
  const row = found.rows[0];
  return row ? toRetailerView(row) : null;
}
