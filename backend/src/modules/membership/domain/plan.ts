/**
 * A14's plan vocabulary. `free` is the absence of a live period, not a stored value, so a shop cannot
 * be "free but locked": the only thing that makes a shop Pro is a `membership.subscriptions` row whose
 * `expires_at` is still in the future.
 *
 * The monthly price lives here (not in config) until A21 exposes it through `/config` and the admin
 * slices make it editable. It is the same number the PWA ships as its own fallback, so a server that
 * answers A14 before A21 exists cannot quote a different price than the app.
 */
export const PRO_MONTHLY_PRICE_TOMAN = 1_490_000;

export type SubscriptionPlan = 'free' | 'pro';

export type SubscriptionHistoryStatus = 'active' | 'expired';

/** A period's status is a function of its own expiry and "now", never a stored flag. */
export function historyStatus(expiresAt: Date, now: Date): SubscriptionHistoryStatus {
  return expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
}
