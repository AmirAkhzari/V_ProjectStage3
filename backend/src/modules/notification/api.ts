/**
 * Public synchronous API of the `notification` module (§9.3 rules 1 and 5).
 */
export type {
  OtpPurpose,
  SmsFailureClass,
  SmsFailureReason,
  SmsOtpResult,
  SmsProvider,
} from './application/ports.js';
export { smsRefundable } from './application/ports.js';
export { createSmsProvider, type SmsProviderConfig } from './infra/sms/createSmsProvider.js';
export { IRAN_MOBILE_RE, OTP_CODE_RE } from './infra/sms/kavenegar/iranMobile.js';

export type NotificationApi = Readonly<Record<never, never>>;

export function createNotificationApi(): NotificationApi {
  return {};
}
