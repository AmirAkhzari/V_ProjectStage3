import type pg from 'pg';
import { withTenant } from '../../../platform/db/tenant.js';
import { findPaymentProvider } from '../infra/providers/registry.js';

/**
 * S3: the provider's callback, which replaces A35's in-app mock confirmation.
 *
 * The callback is a hint, not an authority (contract DL-43 §0 Z4): it carries no signature, so the
 * verdict comes from `provider.verify()` — the server-to-server call that matches the authority (and,
 * with a real PSP, the amount and merchant) on the provider's side. A client cannot pay itself by
 * posting to this route, because the mock provider only verifies authorities it issued.
 *
 * It runs in the platform scope: there is no session on a PSP callback, so the shop comes from the
 * stored payment row. The settlement itself is `payment.settle_pending_payment` (0024), a SECURITY
 * DEFINER function that refuses every non-platform caller, flips only a `pending` row and grants the
 * period in the same statement — FIX-PR1 keeps the app role out of the financial columns, so this is
 * the only path that can mark a payment paid or mint a period.
 *
 * Idempotent on (provider, authority): a replayed notification returns the stored status and never
 * creates a second period; `failed`/`cancelled` are final, so a late "paid" cannot resurrect them.
 */
export interface ProviderCallbackInput {
  provider: string;
  authority: string;
  outcome: 'ok' | 'fail';
}

export type CallbackPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export interface ProviderCallbackResult {
  paymentId: string;
  status: CallbackPaymentStatus;
}

const CALLBACK_SELECT = `SELECT id, status
    FROM payment.payments
   WHERE provider = $1 AND authority = $2`;

export async function receiveProviderCallback(
  pool: pg.Pool,
  input: ProviderCallbackInput,
): Promise<ProviderCallbackResult | null> {
  const provider = findPaymentProvider(input.provider);
  // An unknown provider is the uniform 404: the route is public and must not become a probe.
  if (!provider) return null;

  return withTenant(
    pool,
    { subjectType: 'system', isPlatform: true },
    async (tx): Promise<ProviderCallbackResult | null> => {
      const found = await tx.client.query<{ id: string; status: CallbackPaymentStatus }>(
        CALLBACK_SELECT,
        [input.provider, input.authority],
      );
      const row = found.rows[0];
      if (!row) return null;
      // Replay: the row already has a verdict, and a second notification changes nothing.
      if (row.status !== 'pending') return { paymentId: row.id, status: row.status };

      let paid = input.outcome === 'ok';
      if (paid) {
        const verdict = await provider.verify({ paymentId: row.id, authority: input.authority });
        // `verified` and `already_verified` both mean the provider holds the payment.
        paid = verdict.status !== 'failed';
      }

      const settled = await tx.client.query<{ status: CallbackPaymentStatus; changed: boolean }>(
        `SELECT payment_status AS status, changed FROM payment.settle_pending_payment($1, $2)`,
        [row.id, paid],
      );
      const result = settled.rows[0];
      if (!result) return null;
      return { paymentId: row.id, status: result.status };
    },
  );
}
