import { describe, expect, it } from 'vitest';
import { FakeSmsProvider } from './fakeSmsProvider.js';

describe('FakeSmsProvider', () => {
  it('records OTP sends without performing I/O', async () => {
    const sms = new FakeSmsProvider({ capture: true });
    const result = await sms.sendOtp('+989120000000', '123456', 'app');
    expect(result.status).toBe('sent');
    expect(result.messageId).toBeTruthy();
    expect(sms.outbox).toHaveLength(1);
    expect(sms.name).toBe('fake');
  });
});
