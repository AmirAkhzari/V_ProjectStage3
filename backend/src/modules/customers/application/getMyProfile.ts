import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';

/**
 * A7 response. `plan` and `subscriptionExpiresAt` are real since A14 (0021): they come from the shop's
 * live `membership.subscriptions` period, not from a column on the shop. The remaining fields are
 * `name` (A8/0017), `defaultAddressId` (A9/A10/0018) and `primaryDistributorId` (A16).
 */
export interface MyProfileView {
  user: { id: string; name: string | null; phone: string };
  defaultAddressId: string | null;
  plan: 'free' | 'pro';
  primaryDistributorId: string | null;
  subscriptionExpiresAt: string | null;
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

/** The live period, if any. The plan name comes from the row; `free` is its absence. */
export interface MySubscriptionSummaryRow {
  plan: string;
  expires_at: Date;
}

export const MY_SHOPKEEPER_SELECT = `SELECT id, phone, name, primary_distributor_id,
              default_address_id, status
         FROM customers.shopkeepers`;

/**
 * A7/A8 read the current period directly under the same tenant transaction. This is the same
 * row-owner scope A14 uses (`subscriptions_tenant`, 0021), kept as one statement instead of going
 * through A14's list query: the profile needs only the furthest future expiry, not the history.
 */
export const MY_SUBSCRIPTION_SUMMARY_SELECT = `SELECT plan, expires_at
         FROM membership.subscriptions
        WHERE shopkeeper_id = $1 AND expires_at > now()
        ORDER BY expires_at DESC
        LIMIT 1`;

export function toMyProfileView(
  row: MyShopkeeperRow,
  subscription: MySubscriptionSummaryRow | null,
): MyProfileView {
  return {
    user: { id: row.id, name: row.name ?? null, phone: row.phone },
    defaultAddressId: row.default_address_id ?? null,
    plan: subscription ? 'pro' : 'free',
    primaryDistributorId: row.primary_distributor_id,
    subscriptionExpiresAt: subscription ? subscription.expires_at.toISOString() : null,
  };
}

export async function readMySubscriptionSummary(
  client: pg.PoolClient,
  shopkeeperId: string,
): Promise<MySubscriptionSummaryRow | null> {
  const found = await client.query<MySubscriptionSummaryRow>(MY_SUBSCRIPTION_SUMMARY_SELECT, [
    shopkeeperId,
  ]);
  return found.rows[0] ?? null;
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
  return withTenant(pool, tenant, async ({ client }) => {
    const found = await client.query<MyShopkeeperRow>(`${MY_SHOPKEEPER_SELECT} WHERE id = $1`, [
      tenant.shopkeeperId,
    ]);
    const row = found.rows[0];
    if (!row || row.status !== 'active') return null;
    const subscription = await readMySubscriptionSummary(client, tenant.shopkeeperId!);
    return toMyProfileView(row, subscription);
  });
}
