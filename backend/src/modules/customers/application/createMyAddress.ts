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
 * A10: create one address for the caller. The owner is `app.shopkeeper_id`, never a body field, and
 * FORCE RLS (`addresses_tenant`) is what makes the INSERT own-row-only. The new address also becomes
 * the shop's default (`shopkeepers.default_address_id`, granted by 0018), which is the pointer A7
 * reports as `defaultAddressId`; A12 will switch it to an older address later. The update rides in
 * the same transaction as the insert, so a failed write cannot leave a default pointing at nothing.
 */
export interface CreateMyAddressInput extends MyAddressInput {
  ip: string | null;
}

export async function createMyAddress(
  pool: pg.Pool,
  tenant: TenantContext,
  input: CreateMyAddressInput,
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

    const id = randomUUID();
    const inserted = await tx.client.query<AddressRow>(
      `INSERT INTO customers.addresses (
         id, shopkeeper_id, title, full_address, plaque, unit, tag, branch_name,
         city_name, lat, lng, street_label, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       RETURNING id, title, full_address, plaque, unit, tag, branch_name,
                 city_name, lat, lng, street_label, created_at`,
      [
        id,
        shopkeeperId,
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
    const row = inserted.rows[0];
    // The row was just written under this identity, so a missing RETURNING row is a broken write,
    // not a NOT_FOUND; surfacing null keeps the route's 404 identical to A7/A8 for a hidden shop.
    if (!row) return null;

    await tx.client.query(
      `UPDATE customers.shopkeepers SET default_address_id = $2 WHERE id = $1`,
      [shopkeeperId, id],
    );
    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'shopkeeper', $2, 'shopkeeper', $3, $4, 'address', $5, $6, $7)`,
      [
        randomUUID(),
        shopkeeperId,
        owner.primary_distributor_id,
        'shopkeeper_address_created',
        id,
        JSON.stringify({
          addressId: id,
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
