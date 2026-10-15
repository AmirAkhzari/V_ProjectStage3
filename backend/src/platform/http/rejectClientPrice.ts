import type { onRequestAsyncHookHandler } from 'fastify';
import { AppError } from './errors.js';

/**
 * Prices are server-owned. Skeleton (E2-T4): reject obvious client-supplied price fields.
 * The final field list follows the frozen contract when endpoints are implemented.
 */
export const CLIENT_PRICE_KEYS = ['price', 'unitPrice', 'amount', 'total'] as const;

function containsPriceKey(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined || typeof value !== 'object') {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsPriceKey(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of CLIENT_PRICE_KEYS) {
    if (Object.hasOwn(record, key)) return key;
  }
  for (const nested of Object.values(record)) {
    const found = containsPriceKey(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export const rejectClientPrice: onRequestAsyncHookHandler = async (request) => {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return;
  }
  const key = containsPriceKey(request.body);
  if (key) {
    throw new AppError('VALIDATION_FAILED', 400, 'Client-supplied prices are not accepted', {
      field: key,
    });
  }
};
