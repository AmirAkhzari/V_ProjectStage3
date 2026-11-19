import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../../platform/auth/guards.js';
import { AppError } from '../../../platform/http/errors.js';
import { findDistributor } from '../application/getDistributor.js';
import {
  parseProfileUpdateBody,
  readOptionalIdempotencyKey,
  updateDistributorProfile,
} from '../application/updateDistributorProfile.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin surface for `tenancy`. B25 reads and B27 edits one tenant profile (TEN-404-01, B27). */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/distributors/:id', { schema: { operationId: 'B25' } }, async (request) => {
    requirePermission(request, 'distributors.view');
    const { id } = request.params as { id: string };
    const tenant = request.tenant;
    if (!tenant) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    if (!UUID.test(id)) throw new AppError('NOT_FOUND', 404, 'Resource not found');
    const pool = app.appDb;
    if (!pool) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    const distributor = await findDistributor(pool, tenant, id);
    if (!distributor) throw new AppError('NOT_FOUND', 404, 'Resource not found');
    return distributor;
  });

  app.put('/distributors/:id', { schema: { operationId: 'B27' } }, async (request) => {
    requirePermission(request, 'distributors.manage');
    const tenant = request.tenant;
    if (!tenant) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    const { id } = request.params as { id: string };
    // Body parsing precedes the pool check so a malformed body is always a 400, never a 503.
    const { name } = parseProfileUpdateBody(request.body);
    const idempotencyKey = readOptionalIdempotencyKey(request.headers['idempotency-key']);
    const pool = app.appDb;
    if (!pool) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return updateDistributorProfile(pool, tenant, {
      id,
      name,
      staffId: request.subject?.sub ?? '',
      staffRole: request.staffRole ?? 'staff',
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ip: request.ip,
    });
  });
};
