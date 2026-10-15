import type {
  KycStatus,
  KycVerifier,
  PaymentInquiryStatus,
  PaymentProvider,
  PaymentStartResult,
  PaymentVerifyStatus,
  PayoutProvider,
  PayoutStatus,
} from '../../application/ports.js';

/** Deterministic in-memory PSP double; never performs network I/O. */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly authorities = new Map<string, string>();
  private readonly verified = new Set<string>();

  request(input: { paymentId: string; idempotencyKey: string }): Promise<PaymentStartResult> {
    const existing = this.authorities.get(input.paymentId);
    const authority = existing ?? `MOCK-${input.paymentId}`;
    this.authorities.set(input.paymentId, authority);
    return Promise.resolve({ authority, redirectUrl: `mock://pay/${authority}` });
  }

  verify(input: {
    paymentId: string;
    authority: string;
  }): Promise<{ status: PaymentVerifyStatus }> {
    if (this.authorities.get(input.paymentId) !== input.authority) {
      return Promise.resolve({ status: 'failed' });
    }
    if (this.verified.has(input.authority)) return Promise.resolve({ status: 'already_verified' });
    this.verified.add(input.authority);
    return Promise.resolve({ status: 'verified' });
  }

  inquiry(input: { authority: string }): Promise<{ status: PaymentInquiryStatus }> {
    if (this.verified.has(input.authority)) return Promise.resolve({ status: 'verified' });
    const known = [...this.authorities.values()].includes(input.authority);
    return Promise.resolve({ status: known ? 'in_bank' : 'unknown' });
  }
}

export class MockKycVerifier implements KycVerifier {
  constructor(private readonly result: KycStatus = 'pending') {}

  verify(_input: { subjectId: string }): Promise<{ status: KycStatus }> {
    return Promise.resolve({ status: this.result });
  }
}

export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'mock';
  readonly requested: string[] = [];

  requestPayout(input: {
    payoutId: string;
    idempotencyKey: string;
  }): Promise<{ status: PayoutStatus }> {
    if (!this.requested.includes(input.payoutId)) this.requested.push(input.payoutId);
    return Promise.resolve({ status: 'accepted' });
  }
}
