import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { toDistributorView, type DistributorRow, type DistributorView } from './getDistributor.js';

/**
 * B24: the tenant list behind the admin distributors page and the SuperAdmin switcher.
 * Visibility is decided by RLS, never by the query: a distributor admin sees only its own row
 * (policy `distributors_select`), and a platform-scoped super admin sees every tenant.
 *
 * The frozen contract has no page cursor, so paging is an additive extension: `limit` and the
 * opaque `after` cursor are optional, and the response always carries `hasMore`/`nextAfter`. A
 * tenant table larger than one page is walked page by page instead of being silently truncated
 * at the cap. Rows are ordered by `name, id`, which is exactly the keyset the cursor resumes from
 * (index `distributors_name_id_idx`), so a page never skips or repeats a row.
 */
export const DISTRIBUTORS_LIST_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Optional `limit`: a page size, never a way past `DISTRIBUTORS_LIST_MAX`. Only a canonical
 * decimal (`1`..`500`) is accepted, so `0`, `01`, `1.5` and `501` are 400s instead of surprises.
 */
export function readListLimit(value: unknown): number {
  if (value === undefined) return DISTRIBUTORS_LIST_MAX;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,3}$/.test(value)) throw validationFailed();
  const limit = Number(value);
  if (limit > DISTRIBUTORS_LIST_MAX) throw validationFailed();
  return limit;
}

export interface DistributorCursor {
  name: string;
  id: string;
}

/** `after` is opaque on purpose: a client echoes `nextAfter` instead of building its own cursor. */
export function encodeDistributorCursor(name: string, id: string): string {
  return Buffer.from(`${name}\u0000${id}`, 'utf8').toString('base64url');
}

export function readDistributorCursor(value: unknown): DistributorCursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw validationFailed();
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  // A non-canonical encoding is a client that built the cursor itself; refuse it instead of
  // guessing which row it meant.
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw validationFailed();
  const parts = decoded.split('\u0000');
  if (parts.length !== 2) throw validationFailed();
  const [name, id] = parts as [string, string];
  if (name.length === 0 || !UUID.test(id)) throw validationFailed();
  return { name, id };
}

export interface DistributorListQuery {
  all: boolean;
  limit: number;
  after: DistributorCursor | null;
}

export function readDistributorListQuery(query: unknown): DistributorListQuery {
  const source =
    typeof query === 'object' && query !== null ? (query as Record<string, unknown>) : {};
  return {
    all: readAllFlag(source['all']),
    limit: readListLimit(source['limit']),
    after: readDistributorCursor(source['after']),
  };
}

export interface DistributorList {
  items: DistributorView[];
  hasMore: boolean;
  nextAfter: string | null;
}

export async function listDistributors(
  pool: pg.Pool,
  tenant: TenantContext,
  options: DistributorListQuery,
): Promise<DistributorList> {
  // `all=1` never widens a tenant-scoped caller: the switcher belongs to the platform scope, so a
  // super admin acting inside one tenant (X-Scope-Distributor) is refused instead of escaping it.
  if (options.all && tenant.isPlatform !== true) {
    throw new AppError('FORBIDDEN', 403, 'Forbidden');
  }
  const after = options.after;
  const found = await withTenant(pool, tenant, ({ client }) =>
    client.query<DistributorRow>(
      `SELECT id, name, status, created_at
         FROM tenancy.distributors
        WHERE $1::text IS NULL OR (name, id) > ($1::text, $2::uuid)
        ORDER BY name, id
        LIMIT $3`,
      [after?.name ?? null, after?.id ?? null, options.limit + 1],
    ),
  );
  // One extra row is the "there is a next page" probe; it never reaches the caller.
  const hasMore = found.rows.length > options.limit;
  const rows = hasMore ? found.rows.slice(0, options.limit) : found.rows;
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toDistributorView),
    hasMore,
    nextAfter: hasMore && last ? encodeDistributorCursor(last.name, last.id) : null,
  };
}
