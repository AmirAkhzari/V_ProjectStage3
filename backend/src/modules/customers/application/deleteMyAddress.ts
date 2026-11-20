import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';

/**
 * A13: delete one of the shop's addresses. The contract says "(soft)", so the row is kept and only
 * `deleted_at` marks it gone — 0019 grants UPDATE on that column and never DELETE — and every
 * address read (A9/A11/A12) filters live rows. Rows are never removed, so the audit trail and any
 * later order that named the address keep their referent.
 *
 * When the deleted address was the shop's default, the pointer is cleared in the same transaction so
 * A7 cannot report an address the shop can no longer see. A row that is missing, foreign or already
 * deleted is the same uniform 404: it is not part of the caller's address book any more.
 */
export interface DeleteMyAddressInput {
  id: string;
  ip: string | null;
}

export interface DeletedAddressView {
  id: string;
  defaultAddressId: string | null;
}

export async function deleteMyAddress(
  pool: pg.Pool,
  tenant: TenantContext,
  input: DeleteMyAddressInput,
): Promise<DeletedAddressView | null> {
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

    const deleted = await tx.client.query<{ id: string; city_name: string; tag: string | null }>(
      `UPDATE customers.addresses SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id::text AS id, city_name, tag`,
      [input.id],
    );
    const row = deleted.rows[0];
    if (!row) return null;

    const wasDefault = owner.default_address_id === input.id;
    if (wasDefault) {
      await tx.client.query(
        `UPDATE customers.shopkeepers SET default_address_id = NULL WHERE id = $1`,
        [shopkeeperId],
      );
    }
    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'shopkeeper', $2, 'shopkeeper', $3, $4, 'address', $5, $6, $7)`,
      [
        randomUUID(),
        shopkeeperId,
        owner.primary_distributor_id,
        'shopkeeper_address_deleted',
        input.id,
        JSON.stringify({
          addressId: input.id,
          shopkeeperId,
          cityName: row.city_name,
          tag: row.tag,
          wasDefault,
        }),
        input.ip,
      ],
    );
    return {
      id: input.id,
      defaultAddressId: wasDefault ? null : (owner.default_address_id ?? null),
    };
  });
}
