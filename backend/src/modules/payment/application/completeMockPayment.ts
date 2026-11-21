import type pg from 'pg';
import { createMembershipApi } from '../../membership/api.js';
import type { PaymentStatus } from '../domain/payment.js';

/**
 * A35: the demo PSP's verdict for one payment. Only mounted when demo login is enabled (non-production
 * or staging), exactly like A5/B5, so a production boot has no way to mark a payment paid.
 *
 * The whole answer runs in one tenant transaction with the payment row locked `FOR UPDATE`, which is
 * what makes a double click safe: the second request sees `paid`, returns the same plan and writes no
 * second period. The period itself is created through `membership`'s public API — amounts and window
 * arithmetic stay in that module, and the shop comes from the locked row, never from the request.
 *
 * `failed` is final for this payment: a retry is a new checkout with a new key, not a state flip, so a
 * declined mock payment cannot be replayed into a paid one.
 */
export type MockOutcome = 'ok' | 'fail';

export interface MockCompleteResult {
  status: PaymentStatus;
  plan: 'free' | 'pro';
}

const LOCK_PAYMENT_SELECT = `SELECT p.id, p.kind, p.status, p.amount::int AS amount,
              p.shopkeeper_id::text AS shopkeeper_id
         FROM payment.payments AS p
         JOIN customers.shopkeepers AS s
           ON s.id = p.shopkeeper_id AND s.status = 'active'
        WHERE p.id = $1
        FOR UPDATE OF p`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function completeMockPayment(
  client: pg.PoolClient,
  input: { paymentId: string; outcome: MockOutcome },
): Promise<MockCompleteResult | null> {
  // A malformed id is the uniform 404, not a Postgres cast error.
  if (!UUID.test(input.paymentId)) return null;
  const found = await client.query<{
    id: string;
    kind: string;
    status: PaymentStatus;
    amount: number;
    shopkeeper_id: string;
  }>(LOCK_PAYMENT_SELECT, [input.paymentId]);
  const payment = found.rows[0];
  if (!payment || payment.kind !== 'subscription') return null;

  // Replay: the period already exists, so answer what the first call answered and write nothing.
  if (payment.status === 'paid') return { status: 'paid', plan: 'pro' };
  if (payment.status !== 'pending') return { status: payment.status, plan: 'free' };

  if (input.outcome === 'fail') {
    await client.query(
      `UPDATE payment.payments
          SET status = 'failed', updated_at = now()
        WHERE id = $1`,
      [payment.id],
    );
    return { status: 'failed', plan: 'free' };
  }

  await client.query(
    `UPDATE payment.payments
        SET status = 'paid', paid_at = now(), updated_at = now()
      WHERE id = $1`,
    [payment.id],
  );
  await createMembershipApi().activatePeriod(client, {
    shopkeeperId: payment.shopkeeper_id,
    amount: payment.amount,
  });
  return { status: 'paid', plan: 'pro' };
}
