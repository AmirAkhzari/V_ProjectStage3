import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { toPaymentView, type PaymentRow, type PaymentView } from '../domain/payment.js';

/**
 * A34: one payment of the signed-in shop.
 *
 * Ownership is RLS (`payments_tenant`, 0022) rather than a status code, so an id belonging to another
 * shop, an unknown uuid and a malformed id are all the uniform 404 — no existence oracle. The join on
 * the shop row keeps a blocked/missing shop at the same 404 A7/A14 answer.
 */
// `amount::int`: bigint arrives as a string from pg; A34's contract says number.
export const PAYMENT_VIEW_SELECT = `SELECT p.id, p.kind, p.amount::int AS amount, p.status, p.created_at
         FROM payment.payments AS p
         JOIN customers.shopkeepers AS s
           ON s.id = p.shopkeeper_id AND s.status = 'active'
        WHERE p.id = $1`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getMyPayment(
  pool: pg.Pool,
  tenant: TenantContext,
  paymentId: string,
): Promise<PaymentView | null> {
  if (!tenant.shopkeeperId) return null;
  // A malformed id is the same 404, not a Postgres cast error (and not an existence oracle).
  if (!UUID.test(paymentId)) return null;
  return withTenant(pool, tenant, async (tx) => {
    const found = await tx.client.query<PaymentRow>(PAYMENT_VIEW_SELECT, [paymentId]);
    const row = found.rows[0];
    return row ? toPaymentView(row) : null;
  });
}
