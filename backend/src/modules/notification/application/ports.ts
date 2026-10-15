/**
 * SMS provider port (DL-06: Kavenegar `verify/lookup`). Only a mock exists in Foundation; the real
 * adapter needs an API key and staging, which are out of scope (X-4, X-5).
 */
export interface SmsTemplateMessage {
  receptor: string;
  template: string;
  tokens: readonly string[];
}

export interface SmsSendResult {
  messageId: string;
}

export interface SmsProvider {
  readonly name: string;
  sendTemplate(message: SmsTemplateMessage): Promise<SmsSendResult>;
}
