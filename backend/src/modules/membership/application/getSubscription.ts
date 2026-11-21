import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import {
  historyStatus,
  PRO_MONTHLY_PRICE_TOMAN,
  type SubscriptionHistoryStatus,
  type SubscriptionPlan,
} from '../domain/plan.js';

/**
 * A14: plan, expiry, price and history for the signed-in shop.
 *
 * Identity comes only from the session principal and `withTenant` sets `app.shopkeeper_id`, so the
 * `subscriptions_tenant` policy (0021) is what scopes the periods; the explicit `shopkeeper_id`
 * filter is documentation of that scope, not a substitute for it. A missing or non-active shop is the
 * same uniform 404 A7/A8/A9 answer, so a blocked shop reads no billing data at all.
 *
 * The plan is derived, never stored: a period is live while `expires_at > now()`, and the shop is Pro
 * while one live period exists. `renewal` says whether buying now would extend an existing plan
 * rather than start one — the same fact the PWA's subscription card shows. `price` is the server's
 * monthly price (see `domain/plan.ts`) so the app never has to hardcode what it charges.
 */
export const SUBSCRIPTION_HISTORY_LIMIT = 20;

export interface SubscriptionHistoryView {
  id: string;
  plan: 'pro';
  status: SubscriptionHistoryStatus;
  startsAt: string;
  expiresAt: string;
}

export interface MySubscriptionView {
  plan: SubscriptionPlan;
  primaryDistributorId: string | null;
  expiresAt: string | null;
  renewal: boolean;
  price: number;
  history: SubscriptionHistoryView[];
}

export interface SubscriptionRow {
  id: string;
  plan: string;
  starts_at: Date;
  expires_at: Date;
}

/** Newest expiry first: the first live row is the current period, the rest is history. */
export const MY_SUBSCRIPTION_PERIODS_SELECT = `SELECT id, plan, starts_at, expires_at
         FROM membership.subscriptions
        WHERE shopkeeper_id = $1
        ORDER BY expires_at DESC, id DESC
        LIMIT $2`;

export function toSubscriptionHistoryView(
  rows: readonly SubscriptionRow[],
  now: Date,
): SubscriptionHistoryView[] {
  return rows.map((row) => ({
    id: row.id,
    plan: 'pro',
    status: historyStatus(row.expires_at, now),
    startsAt: row.starts_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  }));
}

export function toMySubscriptionView(
  primaryDistributorId: string | null,
  rows: readonly SubscriptionRow[],
  now: Date,
): MySubscriptionView {
  const live = rows.find((row) => historyStatus(row.expires_at, now) === 'active') ?? null;
  return {
    plan: live ? 'pro' : 'free',
    primaryDistributorId,
    expiresAt: live ? live.expires_at.toISOString() : null,
    renewal: live !== null,
    price: PRO_MONTHLY_PRICE_TOMAN,
    history: toSubscriptionHistoryView(rows, now),
  };
}

export async function getMySubscription(
  pool: pg.Pool,
  tenant: TenantContext,
): Promise<MySubscriptionView | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{ status: string; primary_distributor_id: string | null }>(
      `SELECT status, primary_distributor_id FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const owner = shop.rows[0];
    if (!owner || owner.status !== 'active') return null;

    const periods = await tx.client.query<SubscriptionRow>(MY_SUBSCRIPTION_PERIODS_SELECT, [
      shopkeeperId,
      SUBSCRIPTION_HISTORY_LIMIT,
    ]);
    // One clock for the whole answer, so the plan flag and the history statuses cannot disagree.
    const now = new Date();
    return toMySubscriptionView(owner.primary_distributor_id, periods.rows, now);
  });
}
