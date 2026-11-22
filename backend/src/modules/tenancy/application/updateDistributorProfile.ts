import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { PgIdempotencyStore } from '../../../platform/http/idempotencyPg.js';
import {
  findDistributor,
  toDistributorView,
  type DistributorRow,
  type DistributorView,
} from './getDistributor.js';

/**
 * B27: a distributor admin edits the non-financial profile of one tenant. Only `name` moves in
 * this slice; `status` is operational and the migration grants column-level UPDATE (name) so the
 * database refuses anything else. The read-then-claim order keeps a foreign tenant a 404 before
 * any Idempotency-Key row is written, matching B83.
 */

/** Same limit as a tenant label; a longer name is a client bug, not a truncation opportunity. */
export const PROFILE_NAME_MAX = 200;
export const IDEMPOTENCY_KEY_MIN = 16;
export const IDEMPOTENCY_KEY_MAX = 128;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validationFailed = () =>
  new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');
const notFound = () => new AppError('NOT_FOUND', 404, 'Resource not found');
const idempotencyReuse = () =>
  new AppError('IDEMPOTENCY_KEY_REUSE', 422, 'Idempotency key was reused with a different body');
const idempotencyInProgress = (retryAfter: number) =>
  new AppError('IDEMPOTENCY_IN_PROGRESS', 409, 'Request with this key is in progress', {
    retryAfter,
  });

/**
 * Strict body: exactly `{ name }`. A financial or operational field (`status`, `commission`,
 * `settlement…`) is a 400 rather than a silently ignored key, so a client cannot believe it
 * changed something it may not touch.
 */
export function parseProfileUpdateBody(body: unknown): { name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationFailed();
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'name') throw validationFailed();
  const raw = (body as { name?: unknown }).name;
  if (typeof raw !== 'string') throw validationFailed();
  const name = raw.trim();
  const points = Array.from(name);
  if (points.length === 0 || points.length > PROFILE_NAME_MAX) throw validationFailed();
  // C0/C1 controls (CR/LF/TAB) would let a label forge a log line or an audit entry.
  if (/\p{Cc}/u.test(name)) throw validationFailed();
  return { name };
}

/** Optional `Idempotency-Key`; when present it must be the B83 length window. */
export function readOptionalIdempotencyKey(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw validationFailed();
  if (value.length < IDEMPOTENCY_KEY_MIN || value.length > IDEMPOTENCY_KEY_MAX) {
    throw validationFailed();
  }
  return value;
}

export interface DistributorProfileUpdateInput {
  id: string;
  name: string;
  staffId: string;
  staffRole: string;
  idempotencyKey?: string;
  ip: string | null;
}

function requestHash(name: string): string {
  return createHash('sha256').update(JSON.stringify({ name })).digest('hex');
}

export async function updateDistributorProfile(
  pool: pg.Pool,
  tenant: TenantContext,
  input: DistributorProfileUpdateInput,
): Promise<DistributorView> {
  if (!UUID.test(input.id)) throw notFound();
  // The scope key is the canonical id: an upper-case call and a lower-case replay share one row.
  const id = input.id.toLowerCase();
  const current = await findDistributor(pool, tenant, id);
  if (!current) throw notFound();

  const key = input.idempotencyKey;
  const scope = `B27:${id}`;
  const hash = requestHash(input.name);
  const store = new PgIdempotencyStore(pool);

  if (key) {
    // 0023's idempotency policy reads the tenant GUCs (distributor or platform scope) from the tx.
    const claim = await withTenant(pool, tenant, (tx) =>
      store.claim(scope, input.staffId, key, hash, tx.client),
    );
    if (claim.status === 'completed') {
      if (claim.record.requestHash !== hash) throw idempotencyReuse();
      // A replay is the stored response; no second update and no second audit row.
      return claim.record.response as DistributorView;
    }
    if (claim.status === 'in_progress') throw idempotencyInProgress(claim.retryAfter);
  }

  try {
    return await withTenant(pool, tenant, async (tx) => {
      const updated = await tx.client.query<DistributorRow>(
        `UPDATE tenancy.distributors
            SET name = $2
          WHERE id = $1
          RETURNING id, name, status, created_at`,
        [id, input.name],
      );
      const row = updated.rows[0];
      // RLS hides a foreign tenant, so this is the same 404 as a missing row.
      if (!row) throw notFound();
      const view = toDistributorView(row);
      if (view.name !== current.name) {
        await tx.client.query(
          `INSERT INTO platform.audit_log (
             id, at, actor_type, actor_id, actor_name, distributor_id,
             action, entity, entity_id, data, ip
           ) VALUES ($1, now(), 'staff', $2, $3, $4, $5, 'distributor', $6, $7, $8)`,
          [
            randomUUID(),
            input.staffId,
            input.staffRole,
            tenant.distributorId ?? view.id,
            'distributor_profile_updated',
            view.id,
            JSON.stringify({
              distributorId: view.id,
              nameBefore: current.name,
              nameAfter: view.name,
              role: input.staffRole,
            }),
            input.ip,
          ],
        );
      }
      if (key) {
        await store.complete(
          scope,
          input.staffId,
          key,
          { requestHash: hash, statusCode: 200, response: view },
          tx.client,
        );
      }
      return view;
    });
  } catch (error) {
    if (key) {
      await withTenant(pool, tenant, (tx) =>
        store.abandon(scope, input.staffId, key, tx.client),
      ).catch(() => {});
    }
    throw error;
  }
}
