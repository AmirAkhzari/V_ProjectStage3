import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';

/**
 * B33: the admin retailer list. Visibility is decided by RLS, never by the query: a staff token in
 * one tenant sees the shopkeepers whose primary distributor is that tenant
 * (`shopkeepers_staff_read`), and a platform-scoped super admin sees every shopkeeper.
 *
 * The frozen contract has no page cursor, so paging is an additive extension exactly like B24:
 * `limit` and the opaque `after` cursor are optional, and the response always carries
 * `hasMore`/`nextAfter`. Rows are ordered by `created_at DESC, id DESC`, which is the keyset the
 * cursor resumes from (index `shopkeepers_created_at_id_idx`), so a page never skips or repeats a
 * row while new rows are inserted at the top.
 *
 * `customers.shopkeepers` has no name, city or plan columns yet (profile/membership slices), so the
 * view only carries what the table actually stores. The list can narrow only on `status` and on a
 * phone fragment (`q`). City and plan are not offered until that schema exists, rather than applied
 * to the current page and pretending to be a filter.
 */
export const RETAILERS_LIST_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');

/**
 * Optional `limit`: a page size, never a way past `RETAILERS_LIST_MAX`. Only a canonical decimal
 * (`1`..`500`) is accepted, so `0`, `01`, `1.5` and `501` are 400s instead of surprises.
 */
export function readRetailerListLimit(value: unknown): number {
  if (value === undefined) return RETAILERS_LIST_MAX;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,3}$/.test(value)) throw validationFailed();
  const limit = Number(value);
  if (limit > RETAILERS_LIST_MAX) throw validationFailed();
  return limit;
}

const RETAILER_STATUSES = new Set(['active', 'blocked']);

/** `status` narrows to one lifecycle state, which `customers.shopkeepers.status` already stores. */
export function readRetailerListStatus(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !RETAILER_STATUSES.has(value)) throw validationFailed();
  return value;
}

/**
 * `q` searches the phone number, the only free-text column B33 has. Persian/Arabic digits are folded
 * to ASCII and every separator is dropped, so `۰۹۱۲ ۰۰۰` and `0912-000` are the same probe. A probe
 * with no digits left cannot match a phone, so it is a 400 instead of a silently unfiltered page.
 */
export function readRetailerListSearch(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw validationFailed();
  const digits = value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 32) throw validationFailed();
  return digits;
}

export interface RetailerCursor {
  createdAt: string;
  id: string;
}

export interface RetailerView {
  id: string;
  phone: string;
  status: string;
  primaryDistributorId: string | null;
  primaryDistributorName: string | null;
  createdAt: string;
}

export interface RetailerRow {
  id: string;
  phone: string;
  status: string;
  primary_distributor_id: string | null;
  primary_distributor_name: string | null;
  created_at: Date;
}

/** `after` is opaque on purpose: a client echoes `nextAfter` instead of building its own cursor. */
export function encodeRetailerCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}\u0000${id}`, 'utf8').toString('base64url');
}

export function readRetailerCursor(value: unknown): RetailerCursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw validationFailed();
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  // A non-canonical encoding is a client that built the cursor itself; refuse it instead of
  // guessing which row it meant.
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw validationFailed();
  const parts = decoded.split('\u0000');
  if (parts.length !== 2) throw validationFailed();
  const [createdAt, id] = parts as [string, string];
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime()) || when.toISOString() !== createdAt) throw validationFailed();
  if (!UUID.test(id)) throw validationFailed();
  return { createdAt, id };
}

export interface RetailerListQuery {
  limit: number;
  after: RetailerCursor | null;
  q: string | null;
  status: string | null;
}

export function readRetailerListQuery(query: unknown): RetailerListQuery {
  const source =
    typeof query === 'object' && query !== null ? (query as Record<string, unknown>) : {};
  return {
    limit: readRetailerListLimit(source['limit']),
    after: readRetailerCursor(source['after']),
    q: readRetailerListSearch(source['q']),
    status: readRetailerListStatus(source['status']),
  };
}

export interface RetailerList {
  items: RetailerView[];
  hasMore: boolean;
  nextAfter: string | null;
}

export function toRetailerView(row: RetailerRow): RetailerView {
  return {
    id: row.id,
    phone: row.phone,
    status: row.status,
    primaryDistributorId: row.primary_distributor_id,
    primaryDistributorName: row.primary_distributor_name,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listRetailers(
  pool: pg.Pool,
  tenant: TenantContext,
  options: RetailerListQuery,
): Promise<RetailerList> {
  const after = options.after;
  const found = await withTenant(pool, tenant, ({ client }) =>
    client.query<RetailerRow>(
      `SELECT s.id, s.phone, s.status, s.primary_distributor_id,
              d.name AS primary_distributor_name, s.created_at
         FROM customers.shopkeepers s
         LEFT JOIN tenancy.distributors d ON d.id = s.primary_distributor_id
        WHERE ($1::timestamptz IS NULL
               OR (s.created_at, s.id) < ($1::timestamptz, $2::uuid))
          AND ($4::text IS NULL OR s.phone LIKE '%' || $4 || '%')
          AND ($5::text IS NULL OR s.status = $5)
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $3`,
      [after?.createdAt ?? null, after?.id ?? null, options.limit + 1, options.q, options.status],
    ),
  );
  // One extra row is the "there is a next page" probe; it never reaches the caller.
  const hasMore = found.rows.length > options.limit;
  const rows = hasMore ? found.rows.slice(0, options.limit) : found.rows;
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toRetailerView),
    hasMore,
    nextAfter:
      hasMore && last ? encodeRetailerCursor(last.created_at.toISOString(), last.id) : null,
  };
}
