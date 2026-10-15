import type { LoggerOptions } from 'pino';
import type { Config } from './config.js';

/**
 * Sensitive values (OTP, delivery code, password, tokens) must never reach logs (P0-E7-T4).
 * The final field list depends on the frozen contract payloads; these paths are the baseline.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.otp',
  '*.code',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

export function pinoOptions(config: Pick<Config, 'LOG_LEVEL'>): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
}
