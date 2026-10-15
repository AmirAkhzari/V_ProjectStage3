import { randomUUID } from 'node:crypto';
import type { SmsProvider, SmsSendResult, SmsTemplateMessage } from '../../application/ports.js';

/** Records messages in memory; never performs network I/O. */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly outbox: SmsTemplateMessage[] = [];

  sendTemplate(message: SmsTemplateMessage): Promise<SmsSendResult> {
    this.outbox.push(message);
    return Promise.resolve({ messageId: randomUUID() });
  }
}
