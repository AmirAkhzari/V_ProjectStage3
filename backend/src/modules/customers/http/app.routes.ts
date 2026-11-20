import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { getMyProfile } from '../application/getMyProfile.js';
import { parseShopNameBody, updateMyName } from '../application/updateMyName.js';

/** A7/A8: strict shape; any extra key fails. Placeholder fields are documented nulls. */
export const appMeResponseSchema = z
  .object({
    user: z
      .object({
        id: z.uuid(),
        // A8 gives `name` a real column; null means the shop has not saved one yet.
        name: z.string().nullable(),
        phone: z.string(),
      })
      .strict(),
    defaultAddressId: z.null(),
    plan: z.null(),
    primaryDistributorId: z.uuid().nullable(),
    subscriptionExpiresAt: z.null(),
  })
  .strict();

/** App surface for `customers`: A7 reads the profile, A8 edits the shop's display name. */
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

  app.patch(
    '/me',
    // L-5-1: `no-store` comes from the group hook for A8 too; the 200 is the same profile A7 reads.
    { schema: { operationId: 'A8', response: { 200: appMeResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // Body parsing precedes the pool check so a malformed name is always a 400, never a 503.
      const name = parseShopNameBody(request.body);
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const profile = await updateMyName(pool, tenant, { name, ip: request.ip });
      if (!profile) {
        request.log.info(
          { operationId: 'A8', sub: request.subject?.sub, outcome: 'not_found' },
          'app_me_update',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'A8', sub: request.subject?.sub, outcome: 'ok' },
        'app_me_update',
      );
      return profile;
    },
  );
};
