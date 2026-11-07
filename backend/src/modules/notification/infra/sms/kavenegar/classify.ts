import type { SmsFailureClass, SmsFailureReason } from '../../../application/ports.js';

/**
 * Kavenegar `return.status` from https://kavenegar.com/rest.html.
 * HTTP status uses the same table but is recorded separately (P14-2 / N16-1).
 * Only receptor 411 is refundable. 408/429 are ambiguous. Key/credit/template = ops.
 */
const RECEPTOR = new Set([411]);
const OPS: Record<number, SmsFailureReason> = {
  400: 'unknown',
  401: 'account',
  402: 'unknown',
  403: 'api_key',
  406: 'unknown',
  407: 'ip_allowlist',
  412: 'unknown',
  416: 'ip_allowlist',
  418: 'credit',
  424: 'template',
  426: 'template',
  430: 'account',
  432: 'template',
};
const AMBIGUOUS = new Set([408, 409, 429, 451]);

export function classifyKavenegarCode(code: number): {
  failureClass: SmsFailureClass;
  reason: SmsFailureReason;
} {
  if (RECEPTOR.has(code)) return { failureClass: 'receptor', reason: 'invalid_receptor' };
  if (AMBIGUOUS.has(code) || code >= 500) {
    return {
      failureClass: 'ambiguous',
      reason: code === 429 ? 'rate_limited' : code >= 500 ? 'server' : 'timeout',
    };
  }
  const ops = OPS[code];
  if (ops) return { failureClass: 'ops', reason: ops };
  if (code >= 400 && code < 500) return { failureClass: 'ops', reason: 'unknown' };
  return { failureClass: 'ambiguous', reason: 'unknown' };
}
