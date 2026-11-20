import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { findRetailer, readRetailerId } from './getRetailer.js';
import {
  RETAILER_VIEW_SELECT,
  toRetailerView,
  type RetailerRow,
  type RetailerView,
} from './listRetailers.js';

/**
 * B36: change the distributor a shop belongs to. Like B35 the write is naturally idempotent — the
 * distributor a shop already has is a 200 no-op with no audit row — so it carries no Idempotency-Key.
 *
 * Who may move a shop where is decided by RLS, not by this file: `tenancy.distributors_select` makes
 * a staff token see only its own distributor, so the target-distributor probe below is the
 * assignability check. A staff member therefore can only name its own distributor — a no-op by the
 * time it gets there — while the platform scope (`isPlatform`, narrowed by `X-Scope-Distributor`
 * exactly like B33/B34/B35) is the one that reassigns between tenants.
 * `shopkeepers_staff_update` (0015) also keeps the WITH CHECK side tenant-bound, and 0016 grants the
 * app role this single column, so a tenant token can never hand its shops to someone else.
 *
 * A target distributor the caller cannot see is the same 404 as a missing shop: the endpoint never
 * reports whether another tenant's distributor exists.
 *
 * The body names the *field being written* (`primaryDistributorId`, the same name the view returns),
 * not `distributorId`: the platform hook `rejectClientIdentity` refuses a caller-supplied
 * `distributorId` anywhere because a request's own tenant/scope must come from the token. That rule
 * stays untouched — B36 edits a shop's column under `retailers.manage`, it never lets a caller scope
 * its own request.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');
const notFound = () => new AppError('NOT_FOUND', 404, 'Resource not found');

/** `null` for anything that cannot be a distributor id, which the service answers with a 404. */
export function readDistributorId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Strict body: exactly `{ primaryDistributorId }`. `null` is refused rather than read as "detach":
 * the contract is "change the primary distributor", and clearing it would leave the shop invisible to
 * every tenant token, which is a different operation.
 */
export function parseRetailerPrimaryDistributorBody(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationFailed();
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'primaryDistributorId') throw validationFailed();
  const primaryDistributorId = readDistributorId(
    (body as { primaryDistributorId?: unknown }).primaryDistributorId,
  );
  if (!primaryDistributorId) throw validationFailed();
  return primaryDistributorId;
}

export interface RetailerPrimaryDistributorInput {
  id: string;
  primaryDistributorId: string;
  staffId: string;
  staffRole: string;
  ip: string | null;
}

export async function setRetailerPrimaryDistributor(
  pool: pg.Pool,
  tenant: TenantContext,
  input: RetailerPrimaryDistributorInput,
): Promise<RetailerView> {
  const id = readRetailerId(input.id);
  if (!id) throw notFound();
  const current = await findRetailer(pool, tenant, id);
  // A foreign shop and a missing one are the same 404, and neither reaches the write.
  if (!current) throw notFound();
  if (current.primaryDistributorId === input.primaryDistributorId) return current;

  return withTenant(pool, tenant, async (tx) => {
    // RLS decides which distributors the caller may name; an invisible one is an unknown one.
    const target = await tx.client.query(`SELECT id FROM tenancy.distributors WHERE id = $1`, [
      input.primaryDistributorId,
    ]);
    if (target.rowCount === 0) throw notFound();

    const updated = await tx.client.query(
      `UPDATE customers.shopkeepers SET primary_distributor_id = $2 WHERE id = $1 RETURNING id`,
      [id, input.primaryDistributorId],
    );
    if (updated.rowCount === 0) throw notFound();
    const found = await tx.client.query<RetailerRow>(`${RETAILER_VIEW_SELECT} WHERE s.id = $1`, [
      id,
    ]);
    const row = found.rows[0];
    if (!row) throw notFound();
    const view = toRetailerView(row);
    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), 'staff', $2, $3, $4, $5, 'shopkeeper', $6, $7, $8)`,
      [
        randomUUID(),
        input.staffId,
        input.staffRole,
        tenant.distributorId ?? view.primaryDistributorId,
        'retailer_primary_distributor_changed',
        id,
        JSON.stringify({
          retailerId: id,
          distributorBefore: current.primaryDistributorId,
          distributorAfter: view.primaryDistributorId,
          role: input.staffRole,
          distributorId: view.primaryDistributorId,
        }),
        input.ip,
      ],
    );
    return view;
  });
}
