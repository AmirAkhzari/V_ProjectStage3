/**
 * Provider ports for the `payment` module. Zarinpal (DL-07), payout and KYC stay interface + mock
 * in Foundation (X-4). Amounts are deliberately absent: the money shape is implemented with the
 * payment module (P2), not here.
 */
export interface PaymentStartResult {
  authority: string;
  redirectUrl: string;
}

export type PaymentVerifyStatus = 'verified' | 'already_verified' | 'failed';

export type PaymentInquiryStatus =
  'paid' | 'verified' | 'in_bank' | 'failed' | 'reversed' | 'unknown';

export interface PaymentProvider {
  readonly name: string;
  request(input: { paymentId: string; idempotencyKey: string }): Promise<PaymentStartResult>;
  verify(input: { paymentId: string; authority: string }): Promise<{ status: PaymentVerifyStatus }>;
  inquiry(input: { authority: string }): Promise<{ status: PaymentInquiryStatus }>;
}

export type KycStatus = 'pending' | 'matched' | 'mismatch';

/** Checks that national ID and card belong to the mobile owner (DECISION_LOG §I withdrawal rules). */
export interface KycVerifier {
  verify(input: { subjectId: string }): Promise<{ status: KycStatus }>;
}

export type PayoutStatus = 'accepted' | 'rejected';

export interface PayoutProvider {
  readonly name: string;
  requestPayout(input: {
    payoutId: string;
    idempotencyKey: string;
  }): Promise<{ status: PayoutStatus }>;
}
