import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_MAX,
  IDEMPOTENCY_KEY_MIN,
  readCheckoutIdempotencyKey,
} from '../../src/modules/membership/application/startSubscriptionCheckout.js';
import { toPaymentView } from '../../src/modules/payment/domain/payment.js';

describe('A15 Idempotency-Key', () => {
  it('accepts one value inside the contract range, trimmed by nobody (the key is opaque)', () => {
    expect(readCheckoutIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MIN))).toHaveLength(
      IDEMPOTENCY_KEY_MIN,
    );
    expect(readCheckoutIdempotencyKey(' 0f8c1e6a-5b3d-4e2f-9a71-2c4d6e8f0a1b ')).toBe(
      ' 0f8c1e6a-5b3d-4e2f-9a71-2c4d6e8f0a1b ',
    );
    expect(readCheckoutIdempotencyKey('k'.repeat(IDEMPOTENCY_KEY_MAX))).toHaveLength(
      IDEMPOTENCY_KEY_MAX,
    );
  });

  it('refuses a missing, short, over-long, repeated or non-string key', () => {
    for (const value of [
      undefined,
      '',
      'x'.repeat(IDEMPOTENCY_KEY_MIN - 1),
      'x'.repeat(IDEMPOTENCY_KEY_MAX + 1),
      ['x'.repeat(IDEMPOTENCY_KEY_MIN), 'y'.repeat(IDEMPOTENCY_KEY_MIN)],
    ]) {
      expect(() => readCheckoutIdempotencyKey(value)).toThrowError(
        expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED', statusCode: 400 }),
      );
    }
  });
});

describe('A34 payment view', () => {
  it('maps the stored row to the app vocabulary and an ISO timestamp', () => {
    expect(
      toPaymentView({
        id: '01000000-0000-4000-8000-000000000001',
        kind: 'subscription',
        amount: 1_490_000,
        status: 'paid',
        created_at: new Date('2026-11-21T10:00:00.000Z'),
      }),
    ).toEqual({
      id: '01000000-0000-4000-8000-000000000001',
      kind: 'subscription',
      amount: 1_490_000,
      status: 'paid',
      createdAt: '2026-11-21T10:00:00.000Z',
    });
  });
});
