import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * The one write into `membership.subscriptions`: a paid period for the shop that paid.
 *
 * `starts_at` is `max(now(), the furthest live expiry)`, so buying while Pro extends the plan instead
 * of resetting it, and the month boundary is computed in Postgres (one clock for the whole insert).
 * `expires_at > starts_at` and the `plan = 'pro'` check from 0021 still apply.
 *
 * Callers pass the shop id from a row they already own and locked (A35's payment); the RLS policy (now
 * `WITH CHECK` on the shopkeeper scope, 0022) is the second line of defence that a period can only be
 * named for the caller's own shop.
 */
export const ACTIVATE_PERIOD_SQL = `WITH period AS (
  SELECT GREATEST(
           $3::timestamptz,
           COALESCE(
             (SELECT max(expires_at)
                FROM membership.subscriptions
               WHERE shopkeeper_id = $2 AND expires_at > $3::timestamptz),
             $3::timestamptz
           )
         ) AS starts_at
)
INSERT INTO membership.subscriptions (id, shopkeeper_id, plan, amount, starts_at, expires_at, created_at)
SELECT $1::uuid, $2::uuid, 'pro', $4::bigint, period.starts_at, period.starts_at + interval '1 month', $3::timestamptz
  FROM period
RETURNING id, starts_at, expires_at`;

export interface ActivatePeriodInput {
  shopkeeperId: string;
  amount: number;
  /** One clock for the insert; tests pin it, production omits it. */
  now?: Date;
}

export interface ActivatedPeriod {
  id: string;
  startsAt: Date;
  expiresAt: Date;
}

export async function activatePeriod(
  client: pg.PoolClient,
  input: ActivatePeriodInput,
): Promise<ActivatedPeriod> {
  const id = randomUUID();
  const now = input.now ?? new Date();
  const inserted = await client.query<{ id: string; starts_at: Date; expires_at: Date }>(
    ACTIVATE_PERIOD_SQL,
    [id, input.shopkeeperId, now, input.amount],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('activatePeriod inserted no row');
  return { id: row.id, startsAt: row.starts_at, expiresAt: row.expires_at };
}
