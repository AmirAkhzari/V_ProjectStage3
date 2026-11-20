import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import {
  toAddressView,
  type AddressRow,
  type AddressView,
  type MyAddressInput,
} from '../domain/address.js';

/**
 * A11: rewrite one of the shop's addresses. It is a full replacement of the same strict A10 body —
 * no partial patching, so a field the client omits is never silently left behind — and the path id
 * only selects the row: `addresses_tenant` (FORCE RLS) decides whether the shop may write it, and
 * 0019 grants UPDATE on the address columns only (never `id`, `shopkeeper_id` or `created_at`).
 *
 * A row that is missing, belongs to another shop or was soft-deleted is the same uniform 404, so the
 * path never reveals another tenant's ids. Saving the values the row already has is a 200 no-op with
 * no audit row, like A8/B27/B35/B36. A11 does not move the default pointer (that is A12).
 */
export interface UpdateMyAddressInput extends MyAddressInput {
  id: string;
  ip: string | null;
}

const RETURNING = `RETURNING id, title, full_address, plaque, unit, tag, branch_name,
             city_name, lat, lng, street_label, created_at`;

export async function updateMyAddress(
  pool: pg.Pool,
  tenant: TenantContext,
  input: UpdateMyAddressInput,
): Promise<AddressView | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{ status: string; primary_distributor_id: string | null }>(
      `SELECT status, primary_distributor_id FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const owner = shop.rows[0];
    if (!owner || owner.status !== 'active') return null;

    const current = await tx.client.query<AddressRow>(
      `SELECT id, title, full_address, plaque, unit, tag, branch_name,
              city_name, lat, lng, street_label, created_at
         FROM customers.addresses
        WHERE id = $1 AND deleted_at IS NULL`,
      [input.id],
    );
    const before = current.rows[0];
    if (!before) return null;

    const unchanged =
      before.title === input.title &&
      before.full_address === input.fullAddress &&
      before.plaque === input.plaque &&
      before.unit === input.unit &&
      before.tag === input.tag &&
      before.branch_name === input.branchName &&
      before.city_name === input.cityName &&
      before.lat === input.lat &&
      before.lng === input.lng &&
      before.street_label === input.streetLabel;
    if (unchanged) return toAddressView(before);

    const updated = await tx.client.query<AddressRow>(
      `UPDATE customers.addresses
          SET title = $2, full_address = $3, plaque = $4, unit = $5, tag = $6,
              branch_name = $7, city_name = $8, lat = $9, lng = $10, street_label = $11
        WHERE id = $1 AND deleted_at IS NULL
        ${RETURNING}`,
      [
        input.id,
        input.title,
        input.fullAddress,
        input.plaque,
        input.unit,
        input.tag,
        input.branchName,
        input.cityName,
        input.lat,
        input.lng,
        input.streetLabel,
      ],
    );
    const row = updated.rows[0];
    if (!row) return null;

    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'shopkeeper', $2, 'shopkeeper', $3, $4, 'address', $5, $6, $7)`,
      [
        randomUUID(),
        shopkeeperId,
        owner.primary_distributor_id,
        'shopkeeper_address_updated',
        input.id,
        JSON.stringify({
          addressId: input.id,
          shopkeeperId,
          cityName: input.cityName,
          tag: input.tag,
        }),
        input.ip,
      ],
    );
    return toAddressView(row);
  });
}
