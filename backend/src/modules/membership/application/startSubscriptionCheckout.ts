import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import {
  IDEMPOTENCY_KEY_MAX,
  IDEMPOTENCY_KEY_MIN,
  readIdempotencyKey,
} from '../../../platform/http/idempotencyKey.js';
import { createPaymentApi } from '../../payment/api.js';
import type { CheckoutIntent } from '../../payment/api.js';
import { createMembershipApi } from '../api.js';

/**
 * A15: start a Pro checkout for the signed-in shop.
 *
 * The contract makes `Idempotency-Key` mandatory (16..128), and it is the intent's identity: a replay
 * returns the same `paymentId`/`redirectUrl`/`amount` from the payment row itself, so a client retry can
 * never open two payments or charge twice. A missing or malformed key is 400 `IDEMPOTENCY_KEY_REQUIRED`
 * (the same code B83 uses) rather than a silently generated one, because a server-generated key would
 * make every retry a new payment.
 *
 * The amount is the server's monthly price — the request carries no amount to trust — and the write
 * itself belongs to `payment`'s public API inside this tenant transaction, so the shop check and the
 * intent are one unit.
 */
export { IDEMPOTENCY_KEY_MAX, IDEMPOTENCY_KEY_MIN };

export function readCheckoutIdempotencyKey(value: string | string[] | undefined): string {
  return readIdempotencyKey(value);
}

export async function startSubscriptionCheckout(
  pool: pg.Pool,
  tenant: TenantContext,
  idempotencyKey: string,
): Promise<CheckoutIntent | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{ status: string }>(
      `SELECT status FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const owner = shop.rows[0];
    if (!owner || owner.status !== 'active') return null;

    return createPaymentApi().createSubscriptionPayment(tx.client, {
      shopkeeperId,
      amount: createMembershipApi().monthlyPrice,
      idempotencyKey,
    });
  });
}
