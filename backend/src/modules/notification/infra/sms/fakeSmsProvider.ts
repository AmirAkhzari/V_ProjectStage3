import { randomUUID } from 'node:crypto';
import type { OtpPurpose, SmsOtpResult, SmsProvider } from '../../application/ports.js';

export interface FakeSmsRecord {
  phone: string;
  code: string;
  purpose: OtpPurpose;
}

/**
 * Local/CI provider. Captured-code hook is constructor-only (tests); never HTTP.
 * No network I/O.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly outbox: FakeSmsRecord[] = [];
  nextStatus: SmsOtpResult['status'] = 'sent';

  constructor(private readonly onCode?: (code: string) => void) {}

  sendOtp(phone: string, code: string, purpose: OtpPurpose): Promise<SmsOtpResult> {
    this.outbox.push({ phone, code, purpose });
    this.onCode?.(code);
    const status = this.nextStatus;
    this.nextStatus = 'sent';
    if (status !== 'sent') return Promise.resolve({ status });
    return Promise.resolve({ status: 'sent', messageId: randomUUID() });
  }
}
