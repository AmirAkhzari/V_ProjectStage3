import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';

/**
 * A12: make one of the shop's addresses the default A7 reports as `defaultAddressId` (and the
 * pointer the shopping gates read). Both halves are server-scoped: `addresses_tenant` decides which
 * row the shop can see, and `shopkeepers_tenant` plus 0018's `UPDATE (default_address_id)` grant
 * decide that the pointer belongs to the caller. A foreign, missing or soft-deleted address is the
 * same uniform 404, and choosing the address that is already the default is a 200 no-op with no
 * audit row.
 */
export interface SelectDefaultAddressInput {
  id: string;
  ip: string | null;
}

export interface DefaultAddressView {
  defaultAddressId: string;
}

export async function selectMyDefaultAddress(
  pool: pg.Pool,
  tenant: TenantContext,
  input: SelectDefaultAddressInput,
): Promise<DefaultAddressView | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{
      status: string;
      primary_distributor_id: string | null;
      default_address_id: string | null;
    }>(
      `SELECT status, primary_distributor_id, default_address_id
         FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const owner = shop.rows[0];
    if (!owner || owner.status !== 'active') return null;

    const found = await tx.client.query<{ id: string }>(
      `SELECT id::text AS id FROM customers.addresses
        WHERE id = $1 AND deleted_at IS NULL`,
      [input.id],
    );
    if (!found.rows[0]) return null;

    if (owner.default_address_id === input.id) return { defaultAddressId: input.id };

    await tx.client.query(
      `UPDATE customers.shopkeepers SET default_address_id = $2 WHERE id = $1`,
      [shopkeeperId, input.id],
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
        'shopkeeper_default_address_changed',
        input.id,
        JSON.stringify({
          shopkeeperId,
          addressId: input.id,
          previousAddressId: owner.default_address_id,
        }),
        input.ip,
      ],
    );
    return { defaultAddressId: input.id };
  });
}
