import { randomUUID } from 'node:crypto';
import type { OtpPurpose, SmsOtpResult, SmsProvider } from '../../application/ports.js';

export const FAKE_OUTBOX_CAP = 32;

export interface FakeSmsRecord {
  phone: string;
  code: string;
  purpose: OtpPurpose;
}

/**
 * Local/CI provider. Plaintext capture is opt-in and test-only (N16-2 / P14-7).
 * Outbox is bounded. Never HTTP.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly outbox: FakeSmsRecord[] = [];
  nextStatus: SmsOtpResult['status'] = 'sent';
  nextFailure: Pick<SmsOtpResult, 'failureClass' | 'reason'> | undefined = undefined;

  constructor(private readonly opts: { capture?: boolean; onCode?: (code: string) => void } = {}) {}

  sendOtp(phone: string, code: string, purpose: OtpPurpose): Promise<SmsOtpResult> {
    if (this.opts.capture === true) {
      this.outbox.push({ phone, code, purpose });
      while (this.outbox.length > FAKE_OUTBOX_CAP) this.outbox.shift();
      this.opts.onCode?.(code);
    }
    const status = this.nextStatus;
    const failure = this.nextFailure;
    this.nextStatus = 'sent';
    this.nextFailure = undefined;
    if (status === 'sent') return Promise.resolve({ status: 'sent', messageId: randomUUID() });
    return Promise.resolve({
      status,
      ...(failure?.failureClass !== undefined ? { failureClass: failure.failureClass } : {}),
      ...(failure?.reason !== undefined ? { reason: failure.reason } : {}),
    });
  }
}
