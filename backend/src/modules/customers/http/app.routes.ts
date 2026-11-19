import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { getMyProfile } from '../application/getMyProfile.js';

/** A7: strict shape; any extra key fails. Placeholder fields are documented nulls. */
export const appMeResponseSchema = z
  .object({
    user: z
      .object({
        id: z.uuid(),
        name: z.null(),
        phone: z.string(),
      })
      .strict(),
    defaultAddressId: z.null(),
    plan: z.null(),
    primaryDistributorId: z.uuid().nullable(),
    subscriptionExpiresAt: z.null(),
  })
  .strict();

/** App surface for `customers`. A7 is the only live operation; A8 stays pending. */
export const appRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/me',
    // L-5-1: `cache-control: no-store` comes from the group hook keyed on operationId A7,
    // which already covers 200/401/403/404 and the auto-HEAD route.
    { schema: { operationId: 'A7', response: { 200: appMeResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const profile = await getMyProfile(pool, tenant);
      if (!profile) {
        request.log.info(
          { operationId: 'A7', sub: request.subject?.sub, outcome: 'not_found' },
          'app_me',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info({ operationId: 'A7', sub: request.subject?.sub, outcome: 'ok' }, 'app_me');
      return profile;
    },
  );
};
