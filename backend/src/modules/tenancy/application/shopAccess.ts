import type pg from 'pg';

/**
 * The marketplace gate, in one place: A17 flags a row with it and A18 refuses with it, so the list
 * and the detail can never disagree about what a Free shop may open.
 *
 * "Pro" is derived exactly as A14 derives it (0021): at least one `membership.subscriptions` period
 * whose `expires_at` is still in the future. Nothing is cached and nothing is stored on the shop, so
 * an expiry takes effect on the next request without a job.
 *
 * The read is deliberately local to this module rather than routed through the `membership` api: the
 * tenancy app queries already join `customers.shopkeepers` under the same tenant transaction (see
 * `listAppDistributors`), and A14's own summary read is one statement — a cross-module call would add
 * a hop without changing the answer. `subscriptions_tenant` (0021) is what scopes the subquery: a
 * shopkeeper sees only its own periods, so the EXISTS cannot be widened by the caller.
 */
export interface ShopAccessRow {
  status: string;
  primary_distributor_id: string | null;
  is_pro: boolean;
}

export const SHOP_ACCESS_SELECT = `SELECT s.status, s.primary_distributor_id,
         EXISTS (
           SELECT 1 FROM membership.subscriptions AS sub
            WHERE sub.shopkeeper_id = s.id AND sub.expires_at > now()
         ) AS is_pro
    FROM customers.shopkeepers AS s
   WHERE s.id = $1`;

export async function readShopAccess(
  client: pg.PoolClient,
  shopkeeperId: string,
): Promise<ShopAccessRow | null> {
  const found = await client.query<ShopAccessRow>(SHOP_ACCESS_SELECT, [shopkeeperId]);
  return found.rows[0] ?? null;
}

/**
 * A Free shop may only buy from the distributor it chose (A16); Pro unlocks every distributor in the
 * marketplace. The primary row itself is never locked, plan or no plan.
 */
export function marketplaceLocked(isPro: boolean, isPrimary: boolean): boolean {
  return !isPrimary && !isPro;
}
