/** OTP purpose is bound at send time so app and staff challenges stay separate. */
export type OtpPurpose = 'app' | 'staff';

/** `rejected` is definite (refundable). `ambiguous` is timeout/5xx — never refund. */
export type SmsSendStatus = 'sent' | 'rejected' | 'ambiguous';

export interface SmsOtpResult {
  status: SmsSendStatus;
  messageId?: string;
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
