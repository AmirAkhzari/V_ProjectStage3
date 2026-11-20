import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';

/**
 * A18: the detail of one distributor, behind the marketplace gate.
 *
 * Identity is the session principal, so a missing or non-active shop is the same uniform 404
 * A7/A17 answer. The gate is the shop's plan: a shop always sees its own primary distributor, and
 * every other distributor needs Pro (`403 MARKETPLACE_REQUIRES_PRO`). No plan column exists yet —
 * A7 ships `plan: null` and A14 adds the membership tables — so every shop is free today and the
 * gate reduces to "primary only". That is the intended product rule for a free shop, and A14 only
 * has to pass the real plan into this check.
 *
 * The gate is answered before the distributor probe, exactly like A16's one-time lock: a non-primary
 * id is the same 403 whether it is active, inactive or unknown, so this endpoint is not an existence
 * oracle either. Which row a Pro shop may read is still RLS: `distributors_shopkeeper_read` (0020)
 * shows the shopkeeper scope only `status = 'active'` distributors, so a hidden primary (deactivated
 * after it was chosen) is the uniform 404 rather than an empty 200.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` for anything that cannot be a row id, which the service answers with a 404. */
export function readDistributorId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

export interface AppDistributorDetailView {
  id: string;
  name: string;
  status: string;
  isPrimary: boolean;
}

export async function getAppDistributor(
  pool: pg.Pool,
  tenant: TenantContext,
  distributorId: string,
): Promise<AppDistributorDetailView | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{ status: string; primary_distributor_id: string | null }>(
      `SELECT status, primary_distributor_id FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const owner = shop.rows[0];
    if (!owner || owner.status !== 'active') return null;

    const isPrimary = owner.primary_distributor_id === distributorId;
    if (!isPrimary) {
      throw new AppError('MARKETPLACE_REQUIRES_PRO', 403, 'Marketplace requires the pro plan');
    }

    const found = await tx.client.query<{ id: string; name: string; status: string }>(
      `SELECT id::text AS id, name, status
         FROM tenancy.distributors
        WHERE id = $1 AND status = 'active'`,
      [distributorId],
    );
    const row = found.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, status: row.status, isPrimary: true };
  });
}
