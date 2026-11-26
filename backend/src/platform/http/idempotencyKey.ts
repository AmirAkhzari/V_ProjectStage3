import { AppError } from './errors.js';

/**
 * The frozen contract's `IdempotencyKey` header: mandatory, 16..128 characters. A15 and A36 both
 * require it, and a server-generated key would silently turn every retry into a new intent, so a
 * missing or malformed value is `400 IDEMPOTENCY_KEY_REQUIRED` (the same code B83 uses).
 */
export const IDEMPOTENCY_KEY_MIN = 16;
export const IDEMPOTENCY_KEY_MAX = 128;

export function readIdempotencyKey(value: string | string[] | undefined): string {
  if (
    typeof value !== 'string' ||
    value.length < IDEMPOTENCY_KEY_MIN ||
    value.length > IDEMPOTENCY_KEY_MAX
  ) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key header is required');
  }
  return value;
}
