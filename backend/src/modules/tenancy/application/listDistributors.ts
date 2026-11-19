import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { toDistributorView, type DistributorRow, type DistributorView } from './getDistributor.js';

/**
 * B24: the tenant list behind the admin distributors page and the SuperAdmin switcher.
 * Visibility is decided by RLS, never by the query: a distributor admin sees only its own row
 * (policy `distributors_select`), and a platform-scoped super admin sees every tenant.
 *
 * The frozen contract has no page cursor (only `all`), so the statement is capped at
 * `DISTRIBUTORS_LIST_MAX` rows. A tenant table larger than that is a real product decision for
 * v1.3, not something this slice can paginate.
 */
export const DISTRIBUTORS_LIST_MAX = 500;

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');

/**
 * `all=1` is the contract's "switch tenant" flag (summary: «all=1 برای سوییچر SuperAdmin»).
 * Only the exact value `1` counts: `all=true`, `all=0` and a repeated parameter are client bugs
 * and answer 400 instead of a silently different list.
 */
export function readAllFlag(value: unknown): boolean {
  if (value === undefined) return false;
  if (value === '1') return true;
  throw validationFailed();
}

export interface DistributorList {
  items: DistributorView[];
}

export async function listDistributors(
  pool: pg.Pool,
  tenant: TenantContext,
  options: { all: boolean },
): Promise<DistributorList> {
  // `all=1` never widens a tenant-scoped caller: the switcher belongs to the platform scope, so a
  // super admin acting inside one tenant (X-Scope-Distributor) is refused instead of escaping it.
  if (options.all && tenant.isPlatform !== true) {
    throw new AppError('FORBIDDEN', 403, 'Forbidden');
  }
  const found = await withTenant(pool, tenant, ({ client }) =>
    client.query<DistributorRow>(
      `SELECT id, name, status, created_at
         FROM tenancy.distributors
        ORDER BY name, id
        LIMIT $1`,
      [DISTRIBUTORS_LIST_MAX],
    ),
  );
  return { items: found.rows.map(toDistributorView) };
}
