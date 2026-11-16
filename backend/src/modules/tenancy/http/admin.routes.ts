import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../../platform/auth/guards.js';
import { AppError } from '../../../platform/http/errors.js';
import { findDistributor } from '../application/getDistributor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin surface for `tenancy`. B25 is the first tenant-scoped route (TEN-404-01). */
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
};
