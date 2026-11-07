/** OTP purpose is bound at send time so app and staff challenges stay separate. */
export type OtpPurpose = 'app' | 'staff';

/** `rejected` is refundable only when `failureClass` is `receptor`. */
export type SmsSendStatus = 'sent' | 'rejected' | 'ambiguous' | 'ops';

export type SmsFailureClass = 'receptor' | 'ops' | 'ambiguous';
export type SmsFailureReason =
  | 'invalid_input'
  | 'invalid_receptor'
  | 'api_key'
  | 'credit'
  | 'template'
  | 'account'
  | 'ip_allowlist'
  | 'rate_limited'
  | 'timeout'
  | 'server'
  | 'malformed'
  | 'unknown';

export interface SmsOtpResult {
  status: SmsSendStatus;
  failureClass?: SmsFailureClass;
  reason?: SmsFailureReason;
  messageId?: string;
}

export function smsRefundable(result: SmsOtpResult): boolean {
  return result.status === 'rejected' && result.failureClass === 'receptor';
}

/**
 * SMS port (DL-06). Identity calls this; Kavenegar types stay in
 * `notification/infra/sms/kavenegar`. sms.ir can implement the same port.
 */
export interface SmsProvider {
  readonly name: string;
  sendOtp(phone: string, code: string, purpose: OtpPurpose): Promise<SmsOtpResult>;
}

export interface SmsProviderLog {
  error(bindings: Record<string, unknown>, message: string): void;
  warn?(bindings: Record<string, unknown>, message: string): void;
}
