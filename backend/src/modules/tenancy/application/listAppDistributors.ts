import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { marketplaceLocked, readShopAccess } from './shopAccess.js';

/**
 * A17: the distributors a shopkeeper can pick from. Visibility is RLS, not this query:
 * `distributors_shopkeeper_read` (0020) shows the shopkeeper scope only `status = 'active'` rows, and
 * the explicit `status` filter keeps that true for every other scope too.
 *
 * `isPrimary` is the shop's own pointer (A16/A7), so the picker can mark the current choice. `locked`
 * is the marketplace gate (A14/0021): a Free shop may only use its primary distributor, so every other
 * row is locked, while a Pro shop (a live subscription period) sees nothing locked. The same helper
 * decides A18's 403, so the list and the detail agree.
 *
 * The contract's optional `cityId` cannot narrow anything: `tenancy.distributors` has no city column
 * (the city tables come with B28–B32). The value is validated by the route and then not applied, which
 * is stated in the S12 matrix rather than pretending the list is city-scoped.
 */
export interface AppDistributorView {
  id: string;
  name: string;
  status: string;
  isPrimary: boolean;
  locked: boolean;
}

interface AppDistributorRow {
  id: string;
  name: string;
  status: string;
}

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');

export const CITY_FILTER_MAX = 64;

/**
 * Optional `cityId`: at most one trimmed value of 1..64 code points with no control characters. A
 * repeated parameter arrives as an array and is a 400, like every other malformed query here.
 */
export function readCityFilter(query: unknown): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const value = (query as Record<string, unknown>)['cityId'];
  if (value === undefined) return null;
  if (typeof value !== 'string') throw validationFailed();
  const city = value.trim();
  if (city.length === 0 || Array.from(city).length > CITY_FILTER_MAX) throw validationFailed();
  if (/\p{Cc}/u.test(city)) throw validationFailed();
  return city;
}

/**
 * Identity comes only from the session principal. A missing or non-active shop is the same uniform
 * 404 A7/A8/A16 answer, so a blocked shop reads no distributor list at all.
 */
export async function listAppDistributors(
  pool: pg.Pool,
  tenant: TenantContext,
): Promise<AppDistributorView[] | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const owner = await readShopAccess(tx.client, shopkeeperId);
    if (!owner || owner.status !== 'active') return null;

    // `name, id` is the same order B24 uses, so the picker and the admin list agree.
    const found = await tx.client.query<AppDistributorRow>(
      `SELECT id::text AS id, name, status
         FROM tenancy.distributors
        WHERE status = 'active'
        ORDER BY name, id`,
    );
    return found.rows.map((row) => {
      const isPrimary = row.id === owner.primary_distributor_id;
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        isPrimary,
        locked: marketplaceLocked(owner.is_pro, isPrimary),
      };
    });
  });
}
