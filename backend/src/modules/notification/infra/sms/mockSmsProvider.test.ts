import { describe, expect, it } from 'vitest';
import { MockSmsProvider } from './mockSmsProvider.js';

describe('MockSmsProvider', () => {
  it('records template sends without performing I/O', async () => {
    const sms = new MockSmsProvider();
    const result = await sms.sendTemplate({
      receptor: '09120000000',
      template: 'otp',
      tokens: ['12345'],
    });
    expect(result.messageId).toBeTruthy();
    expect(sms.outbox).toHaveLength(1);
    expect(sms.name).toBe('mock');
  });
});
