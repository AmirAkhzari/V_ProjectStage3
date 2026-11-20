import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { createMyAddress } from '../application/createMyAddress.js';
import { getMyProfile } from '../application/getMyProfile.js';
import { listMyAddresses } from '../application/listMyAddresses.js';
import { parseShopNameBody, updateMyName } from '../application/updateMyName.js';
import { parseMyAddressBody } from '../domain/address.js';

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
    // A9/A10 (0018): the address the shop saved; null until the first A10.
    defaultAddressId: z.uuid().nullable(),
    plan: z.null(),
    primaryDistributorId: z.uuid().nullable(),
    subscriptionExpiresAt: z.null(),
  })
  .strict();

/** One address, exactly as A9 lists it and A10 answers with it. */
const addressResponseSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    fullAddress: z.string(),
    plaque: z.string(),
    unit: z.string(),
    tag: z.enum(['store', 'warehouse', 'branch']).nullable(),
    branchName: z.string().nullable(),
    cityName: z.string(),
    lat: z.number(),
    lng: z.number(),
    streetLabel: z.string(),
    createdAt: z.string(),
  })
  .strict();

const addressesResponseSchema = z.array(addressResponseSchema);

/**
 * App surface for `customers`: A7 reads the profile, A8 edits the shop's display name, A9 lists the
 * address book and A10 adds one address (which becomes the shop's default).
 */
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

  app.get(
    '/me/addresses',
    { schema: { operationId: 'A9', response: { 200: addressesResponseSchema } } },
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
      const addresses = await listMyAddresses(pool, tenant);
      if (!addresses) {
        request.log.info(
          { operationId: 'A9', sub: request.subject?.sub, outcome: 'not_found' },
          'app_addresses',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'A9', sub: request.subject?.sub, outcome: 'ok' },
        'app_addresses',
      );
      return addresses;
    },
  );

  app.post(
    '/me/addresses',
    { schema: { operationId: 'A10', response: { 200: addressResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // Body parsing precedes the pool check so a malformed address is always a 400, never a 503.
      const address = parseMyAddressBody(request.body);
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const saved = await createMyAddress(pool, tenant, { ...address, ip: request.ip });
      if (!saved) {
        request.log.info(
          { operationId: 'A10', sub: request.subject?.sub, outcome: 'not_found' },
          'app_address_create',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'A10', sub: request.subject?.sub, outcome: 'ok', addressId: saved.id },
        'app_address_create',
      );
      return saved;
    },
  );
};
