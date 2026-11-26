import { PRO_MONTHLY_PRICE_TOMAN } from './domain/plan.js';

/**
 * Public synchronous API of the `membership` module (§9.3 rules 1 and 5). Together with `events.ts` this
 * is the only file other modules may import.
 *
 * The price is exposed here (not imported from `domain/plan.ts` by other modules) so the number the shop
 * is charged has exactly one owner. A period is not part of this API: FIX-PR1 keeps the app role out of
 * `membership.subscriptions`, so S3 settles a payment and grants the period through
 * `payment.settle_pending_payment`, which calls `membership.grant_pro_period` in the same transaction.
 */
export interface MembershipApi {
  readonly monthlyPrice: number;
}

export function createMembershipApi(): MembershipApi {
  return { monthlyPrice: PRO_MONTHLY_PRICE_TOMAN };
}
