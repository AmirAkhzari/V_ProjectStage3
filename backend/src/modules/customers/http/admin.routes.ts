import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../../platform/auth/guards.js';
import { AppError } from '../../../platform/http/errors.js';
import { listRetailers, readRetailerListQuery } from '../application/listRetailers.js';

/**
 * Admin surface for `customers`. B33 lists the retailers visible through RLS, page by page.
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/retailers', { schema: { operationId: 'B33' } }, async (request) => {
    requirePermission(request, 'retailers.view');
    const tenant = request.tenant;
    if (!tenant) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    // Query parsing precedes the pool check so a malformed page is always a 400, never a 503.
    const page = readRetailerListQuery(request.query);
    const pool = app.appDb;
    if (!pool) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return listRetailers(pool, tenant, page);
  });
};
