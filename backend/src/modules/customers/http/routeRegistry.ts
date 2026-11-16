import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Customers surface (all PENDING in slice 1b). */
// prettier-ignore
export const customersRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A7', method: 'GET', path: '/v1/app/me', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A8', method: 'PATCH', path: '/v1/app/me', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A9', method: 'GET', path: '/v1/app/me/addresses', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A10', method: 'POST', path: '/v1/app/me/addresses', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A11', method: 'PUT', path: '/v1/app/me/addresses/{id}', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A13', method: 'DELETE', path: '/v1/app/me/addresses/{id}', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A12', method: 'PUT', path: '/v1/app/me/addresses/default', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A16', method: 'POST', path: '/v1/app/me/primary-distributor', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B33', method: 'GET', path: '/v1/admin/retailers', access: { kind: 'permission', allOf: ['retailers.view'] } },
  { operationId: 'B34', method: 'GET', path: '/v1/admin/retailers/{id}', access: { kind: 'permission', allOf: ['retailers.view'] } },
  { operationId: 'B35', method: 'PATCH', path: '/v1/admin/retailers/{id}', access: { kind: 'permission', allOf: ['retailers.manage'] } },
  { operationId: 'B36', method: 'PUT', path: '/v1/admin/retailers/{id}/primary-distributor', access: { kind: 'permission', allOf: ['retailers.manage'] } },
];
