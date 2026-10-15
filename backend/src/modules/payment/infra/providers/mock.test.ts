import { describe, expect, it } from 'vitest';
import { MockKycVerifier, MockPaymentProvider, MockPayoutProvider } from './mock.js';

describe('payment mocks', () => {
  it('is idempotent on request and verify', async () => {
    const psp = new MockPaymentProvider();
    const first = await psp.request({ paymentId: 'p1', idempotencyKey: 'k' });
    const second = await psp.request({ paymentId: 'p1', idempotencyKey: 'k' });
    expect(first.authority).toBe(second.authority);
    expect(await psp.verify({ paymentId: 'p1', authority: first.authority })).toEqual({
      status: 'verified',
    });
    expect(await psp.verify({ paymentId: 'p1', authority: first.authority })).toEqual({
      status: 'already_verified',
    });
  });

  it('keeps kyc and payout as in-memory stubs', async () => {
    const kyc = new MockKycVerifier('pending');
    const payout = new MockPayoutProvider();
    expect(await kyc.verify({ subjectId: 's' })).toEqual({ status: 'pending' });
    expect(await payout.requestPayout({ payoutId: 'w1', idempotencyKey: 'k' })).toEqual({
      status: 'accepted',
    });
  });
});
