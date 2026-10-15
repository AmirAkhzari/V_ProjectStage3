import type { onRequestAsyncHookHandler } from 'fastify';
import { AppError } from './errors.js';

/**
 * Clients must not supply identity/scope ids in body or query; those come from the token (E2-T4).
 * Skeleton: reject the well-known keys. Admin `X-Scope-Distributor` is a header and is not covered
 * here (permission matrix is gated by E3-T4).
 */
export const CLIENT_IDENTITY_KEYS = ['shopkeeperId', 'driverId', 'distributorId'] as const;

function firstForbiddenKey(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return CLIENT_IDENTITY_KEYS.find((key) => Object.hasOwn(record, key));
}

export const rejectClientIdentity: onRequestAsyncHookHandler = async (request) => {
  const fromQuery = firstForbiddenKey(request.query);
  const fromBody = firstForbiddenKey(request.body);
  const key = fromQuery ?? fromBody;
  if (key) {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      'Client-supplied identity fields are not accepted',
      { field: key },
    );
  }
};
