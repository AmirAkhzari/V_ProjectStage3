import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Tenancy surface. B25 stays permission-gated here and in its handler (defense in depth). */
// prettier-ignore
export const tenancyRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A17', method: 'GET', path: '/v1/app/distributors', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A18', method: 'GET', path: '/v1/app/distributors/{id}', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B24', method: 'GET', path: '/v1/admin/distributors', access: { kind: 'permission', allOf: ['distributors.view'] } },
  { operationId: 'B25', method: 'GET', path: '/v1/admin/distributors/{id}', access: { kind: 'permission', allOf: ['distributors.view'] } },
  { operationId: 'B26', method: 'POST', path: '/v1/admin/distributors', access: { kind: 'permission', allOf: ['distributors.manage'] } },
  { operationId: 'B27', method: 'PUT', path: '/v1/admin/distributors/{id}', access: { kind: 'permission', allOf: ['distributors.manage'] } },
  { operationId: 'B28', method: 'PUT', path: '/v1/admin/distributors/{id}/cities', access: { kind: 'permission', allOf: ['distributors.manage'] } },
  { operationId: 'B29', method: 'GET', path: '/v1/admin/cities', access: { kind: 'permission', allOf: ['settings.manage'] } },
  { operationId: 'B30', method: 'POST', path: '/v1/admin/cities', access: { kind: 'permission', allOf: ['settings.manage'] } },
  { operationId: 'B31', method: 'PUT', path: '/v1/admin/cities/{id}', access: { kind: 'permission', allOf: ['settings.manage'] } },
  { operationId: 'B32', method: 'DELETE', path: '/v1/admin/cities/{id}', access: { kind: 'permission', allOf: ['settings.manage'] } },
];
