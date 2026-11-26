import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { defaultPaymentProvider } from '../infra/providers/registry.js';

/**
 * A15's write: create (or replay) the payment intent for one `Idempotency-Key`.
 *
 * The key is the identity of the intent, not a cache entry: `(shopkeeper_id, idempotency_key)` is
 * unique in 0022, so a replay — even one racing the first request — returns the same payment row and
 * the same redirect. There is no second place that could remember a different answer.
 *
 * The insert goes through `payment.create_pending_payment` (0024) because FIX-PR1 keeps the app role out
 * of every financial column: the function checks the caller's shop scope itself and returns the stored
 * id when the key already exists, which is the same `ON CONFLICT DO NOTHING` race settlement as before.
 *
 * The provider comes from the registry (today the in-process mock), so the authority A15 stores is the
 * one A36 re-uses and S3 verifies: one instance per process, not one per call. When a real PSP arrives
 * the intent is still created here and the network redirect belongs to A36's `start`, which is exactly
 * the split the frozen contract describes.
 */
export interface CheckoutIntent {
  paymentId: string;
  redirectUrl: string;
  amount: number;
}

export interface CreateSubscriptionPaymentInput {
  shopkeeperId: string;
  amount: number;
  idempotencyKey: string;
}

const provider = defaultPaymentProvider();

// `amount::int`: bigint arrives as a string from pg, and this value becomes a JSON number.
const FIND_BY_KEY_SELECT = `SELECT id, amount::int AS amount, redirect_url
         FROM payment.payments
        WHERE shopkeeper_id = $1 AND idempotency_key = $2`;

type IntentRow = { id: string; amount: number; redirect_url: string | null };

export async function createSubscriptionPayment(
  client: pg.PoolClient,
  input: CreateSubscriptionPaymentInput,
): Promise<CheckoutIntent> {
  const existing = await client.query<IntentRow>(FIND_BY_KEY_SELECT, [
    input.shopkeeperId,
    input.idempotencyKey,
  ]);
  if (existing.rows[0]) return settle(client, existing.rows[0], input.idempotencyKey);

  await client.query<{ id: string }>(
    `SELECT payment.create_pending_payment($1, $2, $3, $4, $5) AS id`,
    [randomUUID(), input.shopkeeperId, input.amount, provider.name, input.idempotencyKey],
  );

  // Whether we inserted it or lost the race, the row for this key is the answer.
  const stored = await client.query<IntentRow>(FIND_BY_KEY_SELECT, [
    input.shopkeeperId,
    input.idempotencyKey,
  ]);
  const row = stored.rows[0];
  if (!row) throw new Error('A15 intent vanished after create_pending_payment');
  return settle(client, row, input.idempotencyKey);
}

/** Ask the PSP for the redirect once per payment; a row that already has one is a pure replay. */
async function settle(
  client: pg.PoolClient,
  row: IntentRow,
  idempotencyKey: string,
): Promise<CheckoutIntent> {
  if (row.redirect_url) {
    return { paymentId: row.id, redirectUrl: row.redirect_url, amount: row.amount };
  }
  const start = await provider.request({ paymentId: row.id, idempotencyKey });
  await client.query(
    `UPDATE payment.payments
        SET authority = $2, redirect_url = $3, updated_at = now()
      WHERE id = $1`,
    [row.id, start.authority, start.redirectUrl],
  );
  return { paymentId: row.id, redirectUrl: start.redirectUrl, amount: row.amount };
}
