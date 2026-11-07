/**
 * Public synchronous API of the `notification` module (§9.3 rules 1 and 5).
 */
export type { OtpPurpose, SmsOtpResult, SmsProvider } from './application/ports.js';
export { createSmsProvider, type SmsProviderConfig } from './infra/sms/createSmsProvider.js';

export type NotificationApi = Readonly<Record<never, never>>;

export function createNotificationApi(): NotificationApi {
  return {};
}
