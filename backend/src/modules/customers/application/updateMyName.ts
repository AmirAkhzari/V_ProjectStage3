import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import {
  MY_SHOPKEEPER_SELECT,
  readMySubscriptionSummary,
  toMyProfileView,
  type MyProfileView,
  type MyShopkeeperRow,
} from './getMyProfile.js';

/**
 * A8: a shopkeeper edits its own display name. Identity comes only from the session principal, so
 * the body carries the new value and nothing that could point at another row; the write is decided
 * by `shopkeepers_tenant` (own row, or the platform scope) and the app role's column-level UPDATE
 * grant (0017: `name` only, on top of `status` and `primary_distributor_id`).
 *
 * The write is naturally idempotent — saving the name the row already has is a 200 no-op without an
 * audit row — so, like B27/B35/B36, it carries no Idempotency-Key. A missing or non-active row is the
 * same 404 A7 answers. A shopkeeper's own name is not a tenant/scope claim, so the platform's
 * `rejectClientIdentity` hook is untouched.
 */

/** One label, not a paragraph; a longer value is a client bug rather than a truncation chance. */
export const SHOP_NAME_MAX = 100;

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');

/**
 * Strict body: exactly `{ name }`. Any other key is a 400 instead of being ignored, so a caller
 * cannot believe it changed something A8 does not own (`phone`, `primaryDistributorId`, …).
 */
export function parseShopNameBody(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationFailed();
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'name') throw validationFailed();
  const raw = (body as { name?: unknown }).name;
  if (typeof raw !== 'string') throw validationFailed();
  const name = raw.trim();
  // Count code points, not UTF-16 units, so an emoji or a Persian letter is one character.
  const points = Array.from(name);
  if (points.length === 0 || points.length > SHOP_NAME_MAX) throw validationFailed();
  // C0/C1 controls (CR/LF/TAB) would let a label forge a log line or an audit entry.
  if (/\p{Cc}/u.test(name)) throw validationFailed();
  return name;
}

export interface ShopNameUpdateInput {
  name: string;
  ip: string | null;
}

export async function updateMyName(
  pool: pg.Pool,
  tenant: TenantContext,
  input: ShopNameUpdateInput,
): Promise<MyProfileView | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const current = await tx.client.query<MyShopkeeperRow>(
      `${MY_SHOPKEEPER_SELECT} WHERE id = $1`,
      [shopkeeperId],
    );
    const row = current.rows[0];
    if (!row || row.status !== 'active') return null;
    // A14: A8 answers the same profile A7 does, so the plan is read on every path.
    if (row.name === input.name) {
      return toMyProfileView(row, await readMySubscriptionSummary(tx.client, shopkeeperId));
    }

    const updated = await tx.client.query<MyShopkeeperRow>(
      `UPDATE customers.shopkeepers SET name = $2 WHERE id = $1
       RETURNING id, phone, name, primary_distributor_id, status`,
      [shopkeeperId, input.name],
    );
    const next = updated.rows[0];
    if (!next) return null;
    const view = toMyProfileView(next, await readMySubscriptionSummary(tx.client, shopkeeperId));
    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'shopkeeper', $2, 'shopkeeper', $3, $4, 'shopkeeper', $2, $5, $6)`,
      [
        randomUUID(),
        shopkeeperId,
        next.primary_distributor_id,
        'shopkeeper_name_updated',
        JSON.stringify({
          shopkeeperId,
          nameBefore: row.name,
          nameAfter: view.user.name,
        }),
        input.ip,
      ],
    );
    return view;
  });
}
