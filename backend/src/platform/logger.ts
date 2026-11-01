import type { LoggerOptions } from 'pino';
import type { Config } from './config.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'otp',
  'code',
  'phone',
  'phonenumber',
  'mobile',
  'token',
  'accesstoken',
  'refreshtoken',
  'pan',
  'nationalid',
  'iban',
  'card_hash',
  'cardhash',
  'authorization',
  'cookie',
  'x-api-key',
  'x-scope-distributor',
  'jwks',
  'jwt_eddsa_jwks',
  'privatekey',
  'private_key',
  'hash',
]);

const HEADER_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-scope-distributor"]',
];

export const REDACT_PATHS = [
  ...HEADER_REDACT_PATHS,
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.otp',
  '*.code',
  '*.phone',
  '*.phoneNumber',
  '*.mobile',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.pan',
  '*.nationalId',
  '*.iban',
  '*.card_hash',
  '*.cardHash',
  '*.jwks',
  '*.JWT_EDDSA_JWKS',
  '*.privateKey',
  '*.private_key',
  '*.hash',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks nested objects/arrays and censors sensitive keys (L-4). Does not mutate the input. */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactDeep(nested, depth + 1);
  }
  return out;
}

export function pinoOptions(config: Pick<Config, 'LOG_LEVEL'>): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      log(object) {
        return redactDeep(object) as Record<string, unknown>;
      },
    },
  };
}
