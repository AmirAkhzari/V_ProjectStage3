import { describe, expect, it } from 'vitest';
import { FakeSmsProvider } from '../fakeSmsProvider.js';
import { createSmsProvider } from '../createSmsProvider.js';
import { KAVENEGAR_FIXTURES } from './fixtures.js';
import { KAVENEGAR_HOST, KavenegarSmsProvider } from './kavenegarSmsProvider.js';
import { redactSmsSecrets } from './redact.js';

const KEY = 'kavenegar-test-api-key-do-not-leak';
const PHONE = '+989121234567';
const CODE = '042001';
const TEMPLATE = 'vproject-otp';

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('FakeSmsProvider', () => {
  it('records sends in memory with no I/O and exposes a test-only code hook', async () => {
    const seen: string[] = [];
    const sms = new FakeSmsProvider((code) => seen.push(code));
    const result = await sms.sendOtp(PHONE, CODE, 'app');
    expect(result.status).toBe('sent');
    expect(sms.outbox).toEqual([{ phone: PHONE, code: CODE, purpose: 'app' }]);
    expect(seen).toEqual([CODE]);
    sms.nextStatus = 'rejected';
    expect((await sms.sendOtp(PHONE, CODE, 'staff')).status).toBe('rejected');
  });
});

describe('KavenegarSmsProvider recorded fixtures', () => {
  it('POSTs verify/lookup.json with server template and maps success', async () => {
    let seen: RequestInit | undefined;
    let url = '';
    const sms = new KavenegarSmsProvider({
      apiKey: KEY,
      template: TEMPLATE,
      fetch: async (href, init) => {
        url = href;
        seen = init;
        return jsonResponse(KAVENEGAR_FIXTURES.success);
      },
    });
    const result = await sms.sendOtp(PHONE, CODE, 'app');
    expect(result).toEqual({ status: 'sent', messageId: '8792341' });
    expect(url).toBe(`${KAVENEGAR_HOST}/v1/${KEY}/verify/lookup.json`);
    expect(seen?.method).toBe('POST');
    expect(seen?.redirect).toBe('error');
    expect(String(seen?.body)).toContain(`receptor=${encodeURIComponent(PHONE)}`);
    expect(String(seen?.body)).toContain(`token=${CODE}`);
    expect(String(seen?.body)).toContain(`template=${TEMPLATE}`);
  });

  it('maps 4xx / provider 411 to rejected and 5xx / malformed / oversized to ambiguous', async () => {
    const run = (body: string, status: number) =>
      new KavenegarSmsProvider({
        apiKey: KEY,
        template: TEMPLATE,
        fetch: async () => jsonResponse(body, status),
      }).sendOtp(PHONE, CODE, 'app');
    expect((await run(KAVENEGAR_FIXTURES.clientError, 200)).status).toBe('rejected');
    expect((await run('{}', 411)).status).toBe('rejected');
    expect((await run(KAVENEGAR_FIXTURES.serverError, 200)).status).toBe('ambiguous');
    expect((await run('{}', 503)).status).toBe('ambiguous');
    expect((await run(KAVENEGAR_FIXTURES.malformed, 200)).status).toBe('ambiguous');
    expect((await run(KAVENEGAR_FIXTURES.oversized, 200)).status).toBe('ambiguous');
  });

  it('timeouts and fetch throws are ambiguous; no retry', async () => {
    let calls = 0;
    const sms = new KavenegarSmsProvider({
      apiKey: KEY,
      template: TEMPLATE,
      timeoutMs: 20,
      fetch: async (_url, init) => {
        calls += 1;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 200);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
          });
        });
        return jsonResponse(KAVENEGAR_FIXTURES.success);
      },
    });
    expect((await sms.sendOtp(PHONE, CODE, 'app')).status).toBe('ambiguous');
    expect(calls).toBe(1);
    const throwing = new KavenegarSmsProvider({
      apiKey: KEY,
      template: TEMPLATE,
      fetch: async () => {
        throw new Error(`upstream ${KEY} phone=${PHONE} token=${CODE}`);
      },
    });
    expect((await throwing.sendOtp(PHONE, CODE, 'staff')).status).toBe('ambiguous');
  });

  it('rejects invalid receptor/code without fetching; duplicate calls both go out', async () => {
    let calls = 0;
    const sms = new KavenegarSmsProvider({
      apiKey: KEY,
      template: TEMPLATE,
      fetch: async () => {
        calls += 1;
        return jsonResponse(KAVENEGAR_FIXTURES.success);
      },
    });
    expect((await sms.sendOtp('09121234567', CODE, 'app')).status).toBe('rejected');
    expect((await sms.sendOtp(PHONE, '42', 'app')).status).toBe('rejected');
    expect(calls).toBe(0);
    await sms.sendOtp(PHONE, CODE, 'app');
    await sms.sendOtp(PHONE, CODE, 'app');
    expect(calls).toBe(2);
  });

  it('redacts API key, phone and code from error logs', async () => {
    const chunks: string[] = [];
    const sms = new KavenegarSmsProvider({
      apiKey: KEY,
      template: TEMPLATE,
      log: {
        error(bindings, message) {
          chunks.push(JSON.stringify(bindings) + message);
        },
      },
      fetch: async () => {
        throw new Error(`fail ${KEY} ${PHONE} ${CODE} ${KAVENEGAR_HOST}/v1/${KEY}/verify`);
      },
    });
    await sms.sendOtp(PHONE, CODE, 'app');
    const blob = chunks.join('\n');
    expect(blob).not.toContain(KEY);
    expect(blob).not.toContain(PHONE);
    expect(blob).not.toContain(CODE);
    expect(redactSmsSecrets(`https://api.kavenegar.com/v1/${KEY}/x`, [KEY])).not.toContain(KEY);
  });
});

describe('createSmsProvider', () => {
  it('selects fake or kavenegar from config', () => {
    expect(createSmsProvider({ SMS_PROVIDER: 'fake' }).name).toBe('fake');
    expect(
      createSmsProvider(
        {
          SMS_PROVIDER: 'kavenegar',
          KAVENEGAR_API_KEY: KEY,
          KAVENEGAR_TEMPLATE: TEMPLATE,
        },
        { fetch: async () => jsonResponse(KAVENEGAR_FIXTURES.success) },
      ).name,
    ).toBe('kavenegar');
  });

  it('fails closed when kavenegar is selected without key or template', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'kavenegar' })).toThrow(/KAVENEGAR/);
  });
});
