import type pg from 'pg';

/**
 * The Pro period for a shop that paid.
 *
 * The rule lives in `membership.grant_pro_period` (migration 0024) because FIX-PR1 keeps the app role
 * out of `membership.subscriptions`: the function is SECURITY DEFINER, refuses every caller outside the
 * platform scope, and `starts_at = max(now(), furthest live expiry)` extends a running plan instead of
 * resetting it. S3's settlement calls the same function, so exactly one statement mints a period.
 *
 * The helper stays for the payment surface's own tests and any later caller; it is not part of
 * `membership/api.ts`, so no other module can reach it.
 */
export const ACTIVATE_PERIOD_SQL = `SELECT id, starts_at, expires_at
   FROM membership.grant_pro_period($1::uuid, $2::bigint, $3::timestamptz)`;

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
  const now = input.now ?? new Date();
  const inserted = await client.query<{ id: string; starts_at: Date; expires_at: Date }>(
    ACTIVATE_PERIOD_SQL,
    [input.shopkeeperId, input.amount, now],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('activatePeriod inserted no row');
  return { id: row.id, startsAt: row.starts_at, expiresAt: row.expires_at };
}
