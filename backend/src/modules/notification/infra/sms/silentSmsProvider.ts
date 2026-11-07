import type { OtpPurpose, SmsOtpResult, SmsProvider } from '../../application/ports.js';

/** Live-send off: no HTTP, no code capture (P14-1). */
export class SilentSmsProvider implements SmsProvider {
  readonly name = 'silent';
  sendOtp(_phone: string, _code: string, _purpose: OtpPurpose): Promise<SmsOtpResult> {
    return Promise.resolve({ status: 'sent' });
  }
}
