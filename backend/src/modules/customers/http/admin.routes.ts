import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../../platform/auth/guards.js';
import { AppError } from '../../../platform/http/errors.js';
import { findRetailer, readRetailerId } from '../application/getRetailer.js';
import { listRetailers, readRetailerListQuery } from '../application/listRetailers.js';
import {
  parseRetailerPrimaryDistributorBody,
  setRetailerPrimaryDistributor,
} from '../application/setRetailerPrimaryDistributor.js';
import { parseRetailerStatusBody, setRetailerStatus } from '../application/setRetailerStatus.js';

/**
 * Admin surface for `customers`. B33 lists the retailers visible through RLS, page by page, B34 reads
 * one of them under the same visibility, B35 blocks or unblocks it, and B36 moves it to another
 * primary distributor.
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

  app.get('/retailers/:id', { schema: { operationId: 'B34' } }, async (request) => {
    requirePermission(request, 'retailers.view');
    const tenant = request.tenant;
    if (!tenant) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    // An id that cannot be a row is the same 404 as a foreign row, so a client cannot probe for ids.
    const id = readRetailerId((request.params as { id: string }).id);
    if (!id) throw new AppError('NOT_FOUND', 404, 'Resource not found');
    const pool = app.appDb;
    if (!pool) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    const retailer = await findRetailer(pool, tenant, id);
    if (!retailer) throw new AppError('NOT_FOUND', 404, 'Resource not found');
    return retailer;
  });

  app.patch('/retailers/:id', { schema: { operationId: 'B35' } }, async (request) => {
    requirePermission(request, 'retailers.manage');
    const tenant = request.tenant;
    if (!tenant) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    // Body parsing precedes the pool check so a malformed body is always a 400, never a 503.
    const status = parseRetailerStatusBody(request.body);
    const id = readRetailerId((request.params as { id: string }).id);
    if (!id) throw new AppError('NOT_FOUND', 404, 'Resource not found');
    const pool = app.appDb;
    if (!pool) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return setRetailerStatus(pool, tenant, {
      id,
      status,
      staffId: request.subject?.sub ?? '',
      staffRole: request.staffRole ?? 'staff',
      ip: request.ip,
    });
  });

  app.put(
    '/retailers/:id/primary-distributor',
    { schema: { operationId: 'B36' } },
    async (request) => {
      requirePermission(request, 'retailers.manage');
      const tenant = request.tenant;
      if (!tenant) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      // Body parsing precedes the pool check so a malformed body is always a 400, never a 503.
      const primaryDistributorId = parseRetailerPrimaryDistributorBody(request.body);
      const id = readRetailerId((request.params as { id: string }).id);
      if (!id) throw new AppError('NOT_FOUND', 404, 'Resource not found');
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      return setRetailerPrimaryDistributor(pool, tenant, {
        id,
        primaryDistributorId,
        staffId: request.subject?.sub ?? '',
        staffRole: request.staffRole ?? 'staff',
        ip: request.ip,
      });
    },
  );
};
