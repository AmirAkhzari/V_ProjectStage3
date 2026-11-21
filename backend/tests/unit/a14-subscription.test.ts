import { describe, expect, it } from 'vitest';
import {
  historyStatus,
  PRO_MONTHLY_PRICE_TOMAN,
} from '../../src/modules/membership/domain/plan.js';
import {
  toMySubscriptionView,
  type SubscriptionRow,
} from '../../src/modules/membership/application/getSubscription.js';

const NOW = new Date('2026-11-21T10:00:00.000Z');
const LIVE = new Date('2026-12-21T10:00:00.000Z');
const PAST = new Date('2026-10-21T10:00:00.000Z');

const period = (id: string, startsAt: Date, expiresAt: Date): SubscriptionRow => ({
  id,
  plan: 'pro',
  starts_at: startsAt,
  expires_at: expiresAt,
});

describe('A14 plan derivation', () => {
  it('treats a period as active only strictly after now', () => {
    expect(historyStatus(LIVE, NOW)).toBe('active');
    expect(historyStatus(NOW, NOW)).toBe('expired');
    expect(historyStatus(PAST, NOW)).toBe('expired');
  });

  it('answers free with an empty history when the shop never bought a period', () => {
    expect(toMySubscriptionView(null, [], NOW)).toEqual({
      plan: 'free',
      primaryDistributorId: null,
      expiresAt: null,
      renewal: false,
      price: PRO_MONTHLY_PRICE_TOMAN,
      history: [],
    });
  });

  it('answers pro from the furthest live period and keeps expired rows in history', () => {
    const rows = [
      period('b', new Date('2026-12-01T00:00:00.000Z'), LIVE),
      period('a', new Date('2026-09-21T00:00:00.000Z'), PAST),
    ];
    const view = toMySubscriptionView('01000000-0000-4000-8000-000000000001', rows, NOW);
    expect(view.plan).toBe('pro');
    expect(view.renewal).toBe(true);
    expect(view.expiresAt).toBe(LIVE.toISOString());
    expect(view.history.map((row) => [row.id, row.status])).toEqual([
      ['b', 'active'],
      ['a', 'expired'],
    ]);
    expect(view.history[0]).toMatchObject({ plan: 'pro', startsAt: '2026-12-01T00:00:00.000Z' });
  });

  it('falls back to free when every period has expired', () => {
    const view = toMySubscriptionView(
      null,
      [period('a', new Date('2026-09-01T00:00:00.000Z'), PAST)],
      NOW,
    );
    expect(view.plan).toBe('free');
    expect(view.expiresAt).toBeNull();
    expect(view.renewal).toBe(false);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]?.status).toBe('expired');
  });
});
