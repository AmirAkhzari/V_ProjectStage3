import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { findPaymentProvider } from '../infra/providers/registry.js';

/**
 * A36: the PSP request for a payment whose intent A15 already committed.
 *
 * The row is the unit of idempotency, not the header: the `Idempotency-Key` is required by the frozen
 * contract and validated at the route, but what actually keeps retries safe is that the stored
 * authority is re-used while the payment is still pending. The contract caps that at three attempts
 * (`start_count<=3`), so a client cannot keep minting gateway sessions for one intent.
 *
 * Two refusals, both 409 as the contract names them:
 * - `PAYMENT_NOT_STARTABLE`: the payment is no longer pending (paid/failed/cancelled) or the attempt
 *   budget is spent.
 * - `PAYMENT_VERIFICATION_PENDING`: a redirect already exists and the provider says the bank has the
 *   money (`verified`/`paid`) while our own row is still pending — the callback has not landed yet, and
 *   opening a second session would charge the shop twice.
 *
 * Ownership is RLS (`payments_tenant`) plus the active-shop join, so a foreign, unknown or malformed id
 * is the uniform 404 rather than an existence oracle.
 */
export const MAX_PAYMENT_STARTS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `amount::int`: bigint arrives as a string from pg; A36's answer carries a JSON number.
const PAYMENT_START_SELECT = `SELECT p.id, p.amount::int AS amount, p.status, p.provider,
         p.authority, p.redirect_url, p.start_count
    FROM payment.payments AS p
    JOIN customers.shopkeepers AS s
      ON s.id = p.shopkeeper_id AND s.status = 'active'
   WHERE p.id = $1
     FOR UPDATE OF p`;

export interface PaymentStartView {
  paymentId: string;
  redirectUrl: string;
  amount: number;
  status: 'pending';
  authority: string;
  attempts: number;
}

interface PaymentStartRow {
  id: string;
  amount: number;
  status: string;
  provider: string;
  authority: string | null;
  redirect_url: string | null;
  start_count: number;
}

export async function startPayment(
  pool: pg.Pool,
  tenant: TenantContext,
  paymentId: string,
): Promise<PaymentStartView | null> {
  if (!tenant.shopkeeperId) return null;
  // A malformed id is the same 404, not a Postgres cast error (and not an existence oracle).
  if (!UUID.test(paymentId)) return null;

  return withTenant(pool, tenant, async (tx) => {
    const found = await tx.client.query<PaymentStartRow>(PAYMENT_START_SELECT, [paymentId]);
    const row = found.rows[0];
    if (!row) return null;
    if (row.status !== 'pending') {
      throw new AppError('PAYMENT_NOT_STARTABLE', 409, 'Payment is not startable');
    }
    if (row.start_count >= MAX_PAYMENT_STARTS) {
      throw new AppError('PAYMENT_NOT_STARTABLE', 409, 'Payment is not startable');
    }

    const provider = findPaymentProvider(row.provider);
    if (!provider) {
      // A row issued by a provider this deployment no longer has cannot be started or settled.
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }

    let authority = row.authority;
    let redirectUrl = row.redirect_url;
    if (authority !== null && redirectUrl !== null) {
      const inquiry = await provider.inquiry({ authority });
      if (inquiry.status === 'verified' || inquiry.status === 'paid') {
        throw new AppError('PAYMENT_VERIFICATION_PENDING', 409, 'Payment verification is pending');
      }
    } else {
      const started = await provider.request({
        paymentId: row.id,
        idempotencyKey: `${row.provider}:${row.id}`,
      });
      authority = started.authority;
      redirectUrl = started.redirectUrl;
    }

    const updated = await tx.client.query<{ start_count: number }>(
      `UPDATE payment.payments
          SET authority = $2, redirect_url = $3, start_count = start_count + 1, updated_at = now()
        WHERE id = $1
        RETURNING start_count`,
      [row.id, authority, redirectUrl],
    );

    return {
      paymentId: row.id,
      redirectUrl,
      amount: row.amount,
      status: 'pending',
      authority,
      attempts: updated.rows[0]?.start_count ?? row.start_count + 1,
    };
  });
}
