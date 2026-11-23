import type {
  OtpPurpose,
  SmsOtpResult,
  SmsProvider,
  SmsProviderLog,
} from '../../../application/ports.js';
import { classifyKavenegarCode } from './classify.js';
import { IRAN_MOBILE_RE, OTP_CODE_RE } from './iranMobile.js';
import { redactSmsSecrets } from './redact.js';

export const KAVENEGAR_HOST = 'https://api.kavenegar.com';
export const SMS_MAX_RESPONSE_BYTES = 8192;
export const SMS_DEFAULT_TIMEOUT_MS = 4000;
/** Documented template name: letter then alphanumerics/underscore/hyphen (Kavenegar lookup). */
export const KAVENEGAR_TEMPLATE_RE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;

export type SmsHttpResponse = {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};
export type SmsFetch = (url: string, init: RequestInit) => Promise<SmsHttpResponse>;

export interface KavenegarSmsConfig {
  apiKey: string;
  template: string;
  timeoutMs?: number;
  fetch?: SmsFetch;
  log?: SmsProviderLog;
}

function silentLog(): SmsProviderLog {
  return { error() {} };
}

/**
 * HTTPS POST `api.kavenegar.com/v1/{API-KEY}/verify/lookup.json`.
 * Server-owned template. No retries, no redirects, no TLS bypass.
 */
export class KavenegarSmsProvider implements SmsProvider {
  readonly name = 'kavenegar';
  private readonly timeoutMs: number;
  private readonly fetchImpl: SmsFetch;
  private readonly log: SmsProviderLog;

  constructor(private readonly config: KavenegarSmsConfig) {
    this.timeoutMs = config.timeoutMs ?? SMS_DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? (fetch as SmsFetch);
    this.log = config.log ?? silentLog();
  }

  async sendOtp(phone: string, code: string, purpose: OtpPurpose): Promise<SmsOtpResult> {
    void purpose;
    if (
      !IRAN_MOBILE_RE.test(phone) ||
      !OTP_CODE_RE.test(code) ||
      !KAVENEGAR_TEMPLATE_RE.test(this.config.template)
    ) {
      return { status: 'rejected', failureClass: 'receptor', reason: 'invalid_input' };
    }
    const url = `${KAVENEGAR_HOST}/v1/${encodeURIComponent(this.config.apiKey)}/verify/lookup.json`;
    const body = new URLSearchParams({
      receptor: phone,
      token: code,
      template: this.config.template,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
        redirect: 'error',
      });
      const httpClass = classifyHttp(response.status);
      if (httpClass) {
        this.alertOps(httpClass, response.status, 0);
        return httpClass;
      }
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.byteLength > SMS_MAX_RESPONSE_BYTES) {
        return { status: 'ambiguous', failureClass: 'ambiguous', reason: 'malformed' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        return { status: 'ambiguous', failureClass: 'ambiguous', reason: 'malformed' };
      }
      const providerStatus = kavenegarReturnStatus(parsed);
      if (providerStatus === 200) {
        const messageId = kavenegarMessageId(parsed);
        return messageId === undefined ? { status: 'sent' } : { status: 'sent', messageId };
      }
      const mapped = mapClassified(classifyKavenegarCode(providerStatus));
      this.alertOps(mapped, response.status, providerStatus);
      return mapped;
    } catch (error) {
      this.log.error(
        { err: publicSmsError(error, this.config.apiKey, phone, code) },
        'kavenegar verify/lookup failed',
      );
      return { status: 'ambiguous', failureClass: 'ambiguous', reason: 'timeout' };
    } finally {
      clearTimeout(timer);
    }
  }

  private alertOps(result: SmsOtpResult, httpStatus: number, providerStatus: number): void {
    if (result.failureClass !== 'ops') return;
    this.log.error(
      { smsReason: result.reason, httpStatus, providerStatus },
      'kavenegar ops failure',
    );
  }
}

function classifyHttp(httpStatus: number): SmsOtpResult | undefined {
  if (httpStatus < 400) return undefined;
  return mapClassified(classifyKavenegarCode(httpStatus));
}

function mapClassified(mapped: {
  failureClass: SmsOtpResult['failureClass'];
  reason: NonNullable<SmsOtpResult['reason']>;
}): SmsOtpResult {
  if (mapped.failureClass === 'receptor') {
    return { status: 'rejected', failureClass: 'receptor', reason: mapped.reason };
  }
  if (mapped.failureClass === 'ops') {
    return { status: 'ops', failureClass: 'ops', reason: mapped.reason };
  }
  return { status: 'ambiguous', failureClass: 'ambiguous', reason: mapped.reason };
}

function kavenegarReturnStatus(parsed: unknown): number {
  if (typeof parsed !== 'object' || parsed === null || !('return' in parsed)) return 0;
  const ret = (parsed as { return?: { status?: unknown } }).return;
  return typeof ret?.status === 'number' ? ret.status : 0;
}

function kavenegarMessageId(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed)) return undefined;
  const entries = (parsed as { entries?: { messageid?: unknown }[] }).entries;
  const id = entries?.[0]?.messageid;
  return id === undefined ? undefined : String(id);
}

function publicSmsError(
  error: unknown,
  apiKey: string,
  phone: string,
  code: string,
): { name: string; message: string } {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'kavenegar failed';
  return { name, message: redactSmsSecrets(message, [apiKey, phone, code]) };
}
