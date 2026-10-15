import { createDb, type DbHandle, type DbLog } from '../../../../platform/db/pool.js';

/**
 * Identity-only DB handle (AppSec 7-6). Non-identity modules must not import this
 * or read `DATABASE_URL_IDENTITY`; the composition root (`src/main.ts`) may construct it.
 */
export function createIdentityDb(
  databaseUrl: string,
  options: { max?: number; log?: DbLog } = {},
): DbHandle {
  return createDb(databaseUrl, options);
}
