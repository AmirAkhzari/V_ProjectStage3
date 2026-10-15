import { AppError } from './errors.js';

export const SCOPE_DISTRIBUTOR_HEADER = 'x-scope-distributor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SuperAdmin distributor scope from `X-Scope-Distributor` (arch §3.4).
 * Invalid values fail closed; the header is not trusted for shopkeepers.
 */
export function parseScopeDistributorHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (Array.isArray(value) || !UUID.test(value)) {
    throw new AppError('VALIDATION_FAILED', 400, 'Invalid X-Scope-Distributor');
  }
  return value.toLowerCase();
}
