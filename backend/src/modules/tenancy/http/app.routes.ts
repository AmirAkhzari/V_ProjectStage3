import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { getAppDistributor, readDistributorId } from '../application/getAppDistributor.js';
import { listAppDistributors, readCityFilter } from '../application/listAppDistributors.js';

/** One pickable distributor: the row's own fields plus the caller's two flags. */
const appDistributorSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.string(),
    isPrimary: z.boolean(),
    locked: z.boolean(),
  })
  .strict();

const appDistributorsSchema = z.array(appDistributorSchema);

/** A18's detail: the row plus whether it is the caller's own primary distributor. */
const appDistributorDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.string(),
    isPrimary: z.boolean(),
  })
  .strict();

/**
 * App surface for `tenancy`: A17 lists the distributors a shop may buy from, A18 reads one of them
 * behind the marketplace gate (its own primary always; anything else needs the pro plan).
 */
export const appRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/distributors',
    { schema: { operationId: 'A17', response: { 200: appDistributorsSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // The freeze has `cityId`, but the table has no city yet: it is validated, then not applied.
      const cityFilter = readCityFilter(request.query);
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const distributors = await listAppDistributors(pool, tenant);
      if (!distributors) {
        request.log.info(
          { operationId: 'A17', sub: request.subject?.sub, outcome: 'not_found' },
          'app_distributors',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A17',
          sub: request.subject?.sub,
          outcome: 'ok',
          cityId: cityFilter,
          count: distributors.length,
        },
        'app_distributors',
      );
      return distributors;
    },
  );

  app.get(
    '/distributors/:id',
    { schema: { operationId: 'A18', response: { 200: appDistributorDetailSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // A non-uuid is the uniform 404, like every other path id on the app surface.
      const distributorId = readDistributorId((request.params as { id?: string }).id);
      if (!distributorId) {
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      // The marketplace gate is answered inside the service so it runs before the row probe.
      const distributor = await getAppDistributor(pool, tenant, distributorId);
      if (!distributor) {
        request.log.info(
          { operationId: 'A18', sub: request.subject?.sub, outcome: 'not_found' },
          'app_distributor',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A18',
          sub: request.subject?.sub,
          outcome: 'ok',
          distributorId: distributor.id,
        },
        'app_distributor',
      );
      return distributor;
    },
  );
};
