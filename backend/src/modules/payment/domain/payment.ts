/**
 * A15/A34 payment vocabulary. `kind` and `status` are closed sets stored as text with a check
 * constraint (0022), so a typo in code fails the insert instead of inventing a state.
 *
 * The app contract names the kinds `order`/`wallet_topup`/`subscription`; only `subscription` exists
 * today, but the mapping is written now so A34's answer never has to change shape when orders and
 * wallet top-ups land.
 */
export type PaymentKind = 'subscription';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export type AppPaymentKind = 'order' | 'wallet_topup' | 'subscription';

export interface PaymentRow {
  id: string;
  kind: PaymentKind;
  amount: number;
  status: PaymentStatus;
  created_at: Date;
}

export interface PaymentView {
  id: string;
  kind: AppPaymentKind;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
}

/** A34's answer: the shop's own payment, in the vocabulary the PWA's payment screens read. */
export function toPaymentView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    kind: appKind(row.kind),
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

function appKind(kind: PaymentKind): AppPaymentKind {
  return kind === 'subscription' ? 'subscription' : 'order';
}
