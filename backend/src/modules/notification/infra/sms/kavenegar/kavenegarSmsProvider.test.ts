import { describe, expect, it } from 'vitest';
import { smsRefundable } from '../../../application/ports.js';
import { createSmsProvider } from '../createSmsProvider.js';
import { FAKE_OUTBOX_CAP, FakeSmsProvider } from '../fakeSmsProvider.js';
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
  it('captures plaintext only when opted in and bounds the outbox', async () => {
    const silent = new FakeSmsProvider();
    await silent.sendOtp(PHONE, CODE, 'app');
    expect(silent.outbox).toEqual([]);
    const seen: string[] = [];
    const sms = new FakeSmsProvider({ capture: true, onCode: (code) => seen.push(code) });
    await sms.sendOtp(PHONE, CODE, 'app');
    expect(sms.outbox).toEqual([{ phone: PHONE, code: CODE, purpose: 'app' }]);
    expect(seen).toEqual([CODE]);
    for (let i = 0; i < FAKE_OUTBOX_CAP + 5; i += 1) {
      await sms.sendOtp(PHONE, CODE, 'app');
    }
    expect(sms.outbox.length).toBe(FAKE_OUTBOX_CAP);
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
    expect(String(seen?.body)).toContain(`template=${TEMPLATE}`);
  });

  it('N16-1: receptor 411 is refundable; ops 401/403/418/424/426 are not; 408/429 ambiguous', async () => {
    const run = (body: string, status = 200) =>
      new KavenegarSmsProvider({
        apiKey: KEY,
        template: TEMPLATE,
        fetch: async () => jsonResponse(body, status),
      }).sendOtp(PHONE, CODE, 'app');
    const receptor = await run(KAVENEGAR_FIXTURES.receptor411);
    expect(receptor).toMatchObject({
      status: 'rejected',
      failureClass: 'receptor',
      reason: 'invalid_receptor',
    });
    expect(smsRefundable(receptor)).toBe(true);
    expect((await run('{}', 411)).failureClass).toBe('receptor');
    const logs: string[] = [];
    const opsRun = (body: string) =>
      new KavenegarSmsProvider({
        apiKey: KEY,
        template: TEMPLATE,
        log: { error: (b, m) => logs.push(JSON.stringify(b) + m) },
        fetch: async () => jsonResponse(body),
      }).sendOtp(PHONE, CODE, 'app');
    for (const body of [
      KAVENEGAR_FIXTURES.key401,
      KAVENEGAR_FIXTURES.key403,
      KAVENEGAR_FIXTURES.credit418,
      KAVENEGAR_FIXTURES.template424,
      KAVENEGAR_FIXTURES.template426,
    ]) {
      const result = await opsRun(body);
      expect(result.status).toBe('ops');
      expect(smsRefundable(result)).toBe(false);
    }
    expect(logs.join('')).toMatch(/kavenegar ops failure/);
    expect((await run(KAVENEGAR_FIXTURES.timeout408)).status).toBe('ambiguous');
    expect((await run(KAVENEGAR_FIXTURES.rate429)).status).toBe('ambiguous');
    expect((await run('{}', 408)).status).toBe('ambiguous');
    expect((await run('{}', 429)).status).toBe('ambiguous');
    expect((await run(KAVENEGAR_FIXTURES.serverError)).status).toBe('ambiguous');
    expect((await run(KAVENEGAR_FIXTURES.malformed)).status).toBe('ambiguous');
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
  it('keeps fake without capture; live-send off uses silent for kavenegar', async () => {
    expect(createSmsProvider({ SMS_PROVIDER: 'fake' }).name).toBe('fake');
    const silent = createSmsProvider({
      SMS_PROVIDER: 'kavenegar',
      SMS_LIVE_SEND: false,
      KAVENEGAR_API_KEY: KEY,
    });
    expect(silent.name).toBe('silent');
    expect(await silent.sendOtp(PHONE, CODE, 'app')).toMatchObject({
      status: 'ops',
      failureClass: 'ops',
      reason: 'disabled',
    });
  });

  it('refuses placeholder keys and invalid templates on live send', () => {
    expect(() =>
      createSmsProvider({
        SMS_PROVIDER: 'kavenegar',
        SMS_LIVE_SEND: true,
        KAVENEGAR_API_KEY: 'prod-fixture-kavenegar-api-key-32b',
        KAVENEGAR_TEMPLATE: TEMPLATE,
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      createSmsProvider({
        SMS_PROVIDER: 'kavenegar',
        SMS_LIVE_SEND: true,
        KAVENEGAR_API_KEY: 'live-key-not-a-placeholder-value',
        KAVENEGAR_TEMPLATE: 'bad template',
      }),
    ).toThrow(/TEMPLATE/);
  });
});
