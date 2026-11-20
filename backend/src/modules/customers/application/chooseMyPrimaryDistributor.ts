import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';

/**
 * A16: a shopkeeper picks the distributor it buys from. Identity comes only from the session
 * principal, so the body names the column being written and nothing that could point at another
 * shop; the write is decided by `shopkeepers_tenant` (own row, or the platform scope) and by 0016's
 * column-level `UPDATE (primary_distributor_id)` grant.
 *
 * Which distributors a caller may name is RLS, not a WHERE clause: 0020 adds
 * `distributors_shopkeeper_read`, so the app role sees the active distributors and nothing else — an
 * unknown id and an inactive distributor are the same uniform 404, exactly like B36's target probe.
 * Saving the distributor the shop already has is a 200 no-op with no audit row (like A8/B27/B35/B36),
 * so A16 carries no Idempotency-Key and re-posting is safe.
 *
 * The choice is one-time (the PWA and the product copy already treat it that way): once
 * `primary_distributor_id` is set, any *other* id is a `409 DISTRIBUTOR_LOCKED` and only the admin
 * endpoint B36 (`retailers.manage`) can move the shop. The lock is answered before the target probe,
 * so a locked shop gets the same 409 for an active, an inactive and an unknown distributor — the
 * endpoint never becomes an existence oracle. That also closes the plan bypass: a free shop cannot
 * hop its primary distributor to reach another distributor's marketplace.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');

/** `null` for anything that cannot be a distributor id, which the service answers with a 404. */
export function readPrimaryDistributorId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Strict body: exactly `{ primaryDistributorId }` — the same name A7 returns. `distributorId` (the
 * request's own tenant scope) is refused by the platform's `rejectClientIdentity` hook, and `null` is
 * refused here rather than read as "detach": the contract is "choose a primary distributor", and a
 * shop without one cannot browse any distributor.
 */
export function parsePrimaryDistributorBody(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationFailed();
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'primaryDistributorId') throw validationFailed();
  const primaryDistributorId = readPrimaryDistributorId(
    (body as { primaryDistributorId?: unknown }).primaryDistributorId,
  );
  if (!primaryDistributorId) throw validationFailed();
  return primaryDistributorId;
}

export interface ChoosePrimaryDistributorInput {
  primaryDistributorId: string;
  ip: string | null;
}

export interface PrimaryDistributorView {
  primaryDistributorId: string;
}

export async function chooseMyPrimaryDistributor(
  pool: pg.Pool,
  tenant: TenantContext,
  input: ChoosePrimaryDistributorInput,
): Promise<PrimaryDistributorView | null> {
  const shopkeeperId = tenant.shopkeeperId;
  if (!shopkeeperId) return null;
  return withTenant(pool, tenant, async (tx) => {
    const shop = await tx.client.query<{ status: string; primary_distributor_id: string | null }>(
      `SELECT status, primary_distributor_id FROM customers.shopkeepers WHERE id = $1`,
      [shopkeeperId],
    );
    const owner = shop.rows[0];
    if (!owner || owner.status !== 'active') return null;

    if (owner.primary_distributor_id === input.primaryDistributorId) {
      return { primaryDistributorId: input.primaryDistributorId };
    }
    // One-time choice: only B36 moves a shop that already has a distributor, and the lock comes
    // before the target probe so the answer does not depend on whether the id exists.
    if (owner.primary_distributor_id !== null) {
      throw new AppError('DISTRIBUTOR_LOCKED', 409, 'Primary distributor is already chosen');
    }

    // RLS decides which distributors this caller may name; an invisible one is an unknown one.
    const target = await tx.client.query<{ id: string }>(
      `SELECT id::text AS id FROM tenancy.distributors WHERE id = $1`,
      [input.primaryDistributorId],
    );
    if (!target.rows[0]) return null;

    const updated = await tx.client.query(
      `UPDATE customers.shopkeepers SET primary_distributor_id = $2 WHERE id = $1 RETURNING id`,
      [shopkeeperId, input.primaryDistributorId],
    );
    // The row was just read under this identity, so a missing UPDATE means the policy refused the
    // write; surfacing null keeps the route's 404 identical to A7/A8 for a hidden shop.
    if (updated.rowCount === 0) return null;

    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'shopkeeper', $2, 'shopkeeper', $3, $4, 'shopkeeper', $2, $5, $6)`,
      [
        randomUUID(),
        shopkeeperId,
        input.primaryDistributorId,
        'shopkeeper_primary_distributor_changed',
        JSON.stringify({
          shopkeeperId,
          distributorBefore: owner.primary_distributor_id,
          distributorAfter: input.primaryDistributorId,
        }),
        input.ip,
      ],
    );
    return { primaryDistributorId: input.primaryDistributorId };
  });
}
