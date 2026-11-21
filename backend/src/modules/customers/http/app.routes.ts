import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import {
  chooseMyPrimaryDistributor,
  parsePrimaryDistributorBody,
} from '../application/chooseMyPrimaryDistributor.js';
import { createMyAddress } from '../application/createMyAddress.js';
import { deleteMyAddress } from '../application/deleteMyAddress.js';
import { getMyProfile } from '../application/getMyProfile.js';
import { listMyAddresses } from '../application/listMyAddresses.js';
import { selectMyDefaultAddress } from '../application/selectDefaultAddress.js';
import { updateMyAddress } from '../application/updateMyAddress.js';
import { parseShopNameBody, updateMyName } from '../application/updateMyName.js';
import { parseDefaultAddressBody, parseMyAddressBody, readAddressId } from '../domain/address.js';

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
    // A14 (0021): the plan and its expiry are derived from the shop's live subscription period.
    plan: z.enum(['free', 'pro']),
    primaryDistributorId: z.uuid().nullable(),
    subscriptionExpiresAt: z.string().nullable(),
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

/** A12 answers the pointer it just moved; A13 answers the deleted id and the surviving default. */
const defaultAddressResponseSchema = z.object({ defaultAddressId: z.uuid() }).strict();
const deletedAddressResponseSchema = z
  .object({ id: z.uuid(), defaultAddressId: z.uuid().nullable() })
  .strict();

/** A16 answers the distributor it just saved, the same name A7 reports. */
const primaryDistributorResponseSchema = z.object({ primaryDistributorId: z.uuid() }).strict();

const addressIdOf = (request: { params: unknown }): string | null =>
  readAddressId((request.params as { id?: unknown }).id);

/**
 * App surface for `customers`: A7 reads the profile, A8 edits the shop's display name, A9 lists the
 * address book, A10 adds one address (which becomes the shop's default), A11 rewrites one, A12
 * chooses the default and A13 soft-deletes one, and A16 chooses the shop's primary distributor.
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

  app.put(
    '/me/addresses/:id',
    { schema: { operationId: 'A11', response: { 200: addressResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // Body parsing precedes the pool check so a malformed address is always a 400, never a 503.
      const address = parseMyAddressBody(request.body);
      // An id that cannot be a row is the same 404 as a foreign or deleted row.
      const id = addressIdOf(request);
      if (!id) throw new AppError('NOT_FOUND', 404, 'Resource not found');
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const saved = await updateMyAddress(pool, tenant, { ...address, id, ip: request.ip });
      if (!saved) {
        request.log.info(
          { operationId: 'A11', sub: request.subject?.sub, outcome: 'not_found' },
          'app_address_update',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'A11', sub: request.subject?.sub, outcome: 'ok', addressId: saved.id },
        'app_address_update',
      );
      return saved;
    },
  );

  app.put(
    '/me/addresses/default',
    { schema: { operationId: 'A12', response: { 200: defaultAddressResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // Body parsing precedes the pool check so a malformed body is always a 400, never a 503.
      const id = parseDefaultAddressBody(request.body);
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const result = await selectMyDefaultAddress(pool, tenant, { id, ip: request.ip });
      if (!result) {
        request.log.info(
          { operationId: 'A12', sub: request.subject?.sub, outcome: 'not_found' },
          'app_address_default',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A12',
          sub: request.subject?.sub,
          outcome: 'ok',
          addressId: result.defaultAddressId,
        },
        'app_address_default',
      );
      return result;
    },
  );

  app.delete(
    '/me/addresses/:id',
    { schema: { operationId: 'A13', response: { 200: deletedAddressResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // An id that cannot be a row is the same 404 as a foreign or already-deleted row.
      const id = addressIdOf(request);
      if (!id) throw new AppError('NOT_FOUND', 404, 'Resource not found');
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const deleted = await deleteMyAddress(pool, tenant, { id, ip: request.ip });
      if (!deleted) {
        request.log.info(
          { operationId: 'A13', sub: request.subject?.sub, outcome: 'not_found' },
          'app_address_delete',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'A13', sub: request.subject?.sub, outcome: 'ok', addressId: deleted.id },
        'app_address_delete',
      );
      return deleted;
    },
  );

  app.post(
    '/me/primary-distributor',
    { schema: { operationId: 'A16', response: { 200: primaryDistributorResponseSchema } } },
    async (request) => {
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      // Body parsing precedes the pool check so a malformed body is always a 400, never a 503.
      const primaryDistributorId = parsePrimaryDistributorBody(request.body);
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const chosen = await chooseMyPrimaryDistributor(pool, tenant, {
        primaryDistributorId,
        ip: request.ip,
      });
      if (!chosen) {
        request.log.info(
          { operationId: 'A16', sub: request.subject?.sub, outcome: 'not_found' },
          'app_primary_distributor',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A16',
          sub: request.subject?.sub,
          outcome: 'ok',
          distributorId: chosen.primaryDistributorId,
        },
        'app_primary_distributor',
      );
      return chosen;
    },
  );
};
