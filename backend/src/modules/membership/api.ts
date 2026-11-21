import type pg from 'pg';
import {
  activatePeriod,
  type ActivatePeriodInput,
  type ActivatedPeriod,
} from './application/activateSubscription.js';
import { PRO_MONTHLY_PRICE_TOMAN } from './domain/plan.js';

/**
 * Public synchronous API of the `membership` module (§9.3 rules 1 and 5). Together with `events.ts` this
 * is the only file other modules may import.
 *
 * The price is exposed here (not imported from `domain/plan.ts` by other modules) so the number the shop
 * is charged has exactly one owner: A15 asks for it instead of carrying a copy.
 */
export interface MembershipApi {
  readonly monthlyPrice: number;
  activatePeriod(client: pg.PoolClient, input: ActivatePeriodInput): Promise<ActivatedPeriod>;
}

export function createMembershipApi(): MembershipApi {
  return { monthlyPrice: PRO_MONTHLY_PRICE_TOMAN, activatePeriod };
}
