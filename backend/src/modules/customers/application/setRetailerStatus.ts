import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { isRetailerStatus, type RetailerStatus } from '../domain/retailerStatus.js';
import { findRetailer, readRetailerId } from './getRetailer.js';
import {
  RETAILER_VIEW_SELECT,
  toRetailerView,
  type RetailerRow,
  type RetailerView,
} from './listRetailers.js';

/**
 * B35: block or unblock one shop. The write is naturally idempotent — the same status is a 200 no-op
 * that leaves no audit row — so it carries no Idempotency-Key: a retry can never produce a different
 * status. Visibility and the write itself are RLS-decided (`shopkeepers_staff_update`), and migration
 * 0015 narrows the app role's UPDATE grant to the `status` column, so no other field moves here.
 */
const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');
const notFound = () => new AppError('NOT_FOUND', 404, 'Resource not found');

/** Strict body: exactly `{ status }`, one of the two states the column holds. */
export function parseRetailerStatusBody(body: unknown): RetailerStatus {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationFailed();
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'status') throw validationFailed();
  const status = (body as { status?: unknown }).status;
  if (!isRetailerStatus(status)) throw validationFailed();
  return status;
}

export interface RetailerStatusInput {
  id: string;
  status: RetailerStatus;
  staffId: string;
  staffRole: string;
  ip: string | null;
}

export async function setRetailerStatus(
  pool: pg.Pool,
  tenant: TenantContext,
  input: RetailerStatusInput,
): Promise<RetailerView> {
  const id = readRetailerId(input.id);
  if (!id) throw notFound();
  const current = await findRetailer(pool, tenant, id);
  // A foreign shop and a missing one are the same 404, and neither reaches the write.
  if (!current) throw notFound();
  if (current.status === input.status) return current;

  return withTenant(pool, tenant, async (tx) => {
    const updated = await tx.client.query(
      `UPDATE customers.shopkeepers SET status = $2 WHERE id = $1 RETURNING id`,
      [id, input.status],
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
        'retailer_status_updated',
        id,
        JSON.stringify({
          retailerId: id,
          statusBefore: current.status,
          statusAfter: view.status,
          role: input.staffRole,
          distributorId: view.primaryDistributorId,
        }),
        input.ip,
      ],
    );
    return view;
  });
}
