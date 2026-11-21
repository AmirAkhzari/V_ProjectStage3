import type pg from 'pg';
import { createSubscriptionPayment, type CheckoutIntent } from './application/createPayment.js';

export type { CheckoutIntent } from './application/createPayment.js';

/**
 * Public synchronous API of the `payment` module (§9.3 rules 1 and 5). Together with `events.ts` this
 * is the only file other modules may import. Operations take the caller's transaction so a checkout can
 * be composed atomically with the caller's own checks (A15 runs them inside `membership`'s tenant
 * transaction).
 */
export interface PaymentApi {
  createSubscriptionPayment(
    client: pg.PoolClient,
    input: { shopkeeperId: string; amount: number; idempotencyKey: string },
  ): Promise<CheckoutIntent>;
}

export function createPaymentApi(): PaymentApi {
  return { createSubscriptionPayment };
}
