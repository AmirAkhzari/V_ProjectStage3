import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { MockPaymentProvider } from '../infra/providers/mock.js';

/**
 * A15's write: create (or replay) the payment intent for one `Idempotency-Key`.
 *
 * The key is the identity of the intent, not a cache entry: `(shopkeeper_id, idempotency_key)` is
 * unique in 0022, so a replay — even one racing the first request — returns the same payment row and
 * the same redirect. There is no second place that could remember a different answer.
 *
 * The provider is the in-process mock (DL-07's Zarinpal lands with A36). Calling it here is safe
 * because it performs no network I/O; when a real PSP arrives the intent is still created here and the
 * redirect is fetched by A36's `start`, which is exactly the split the frozen contract describes.
 * One module-level instance keeps the mock's authority map stable across replays.
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

const provider = new MockPaymentProvider();

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

  const id = randomUUID();
  const inserted = await client.query<IntentRow>(
    `INSERT INTO payment.payments (
       id, shopkeeper_id, kind, amount, status, provider, idempotency_key, created_at, updated_at
     ) VALUES ($1, $2, 'subscription', $3, 'pending', $4, $5, now(), now())
     ON CONFLICT (shopkeeper_id, idempotency_key) DO NOTHING
     RETURNING id, amount::int AS amount, redirect_url`,
    [id, input.shopkeeperId, input.amount, provider.name, input.idempotencyKey],
  );
  if (inserted.rows[0]) return settle(client, inserted.rows[0], input.idempotencyKey);

  // Lost the race against a concurrent request with the same key: that request's row is the answer.
  const raced = await client.query<IntentRow>(FIND_BY_KEY_SELECT, [
    input.shopkeeperId,
    input.idempotencyKey,
  ]);
  const row = raced.rows[0];
  if (!row) throw new Error('A15 idempotency conflict without a stored payment');
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
