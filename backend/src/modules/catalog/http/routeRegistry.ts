import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Catalog surface (all PENDING in slice 1b). */
// prettier-ignore
export const catalogRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A19', method: 'GET', path: '/v1/app/distributors/{id}/catalog', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A21', method: 'GET', path: '/v1/app/search', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A22', method: 'GET', path: '/v1/app/deals', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A23', method: 'GET', path: '/v1/app/compare', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B11', method: 'GET', path: '/v1/admin/products', access: { kind: 'permission', allOf: ['products.view'] } },
  { operationId: 'B13', method: 'POST', path: '/v1/admin/products', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B12', method: 'GET', path: '/v1/admin/products/{id}', access: { kind: 'permission', allOf: ['products.view'] } },
  { operationId: 'B14', method: 'PUT', path: '/v1/admin/products/{id}', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B15', method: 'PATCH', path: '/v1/admin/products/{id}', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B16', method: 'DELETE', path: '/v1/admin/products/{id}', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B17', method: 'POST', path: '/v1/admin/products/import', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B18', method: 'GET', path: '/v1/admin/categories', access: { kind: 'permission', allOf: ['products.view'] } },
  { operationId: 'B19', method: 'POST', path: '/v1/admin/categories', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B20', method: 'PUT', path: '/v1/admin/categories/{id}', access: { kind: 'permission', allOf: ['products.manage'] } },
  { operationId: 'B21', method: 'GET', path: '/v1/admin/stock', access: { kind: 'permission', allOf: ['stock.view'] } },
  { operationId: 'B22', method: 'PUT', path: '/v1/admin/stock', access: { kind: 'permission', allOf: ['stock.manage'] } },
  { operationId: 'B23', method: 'PUT', path: '/v1/admin/distributors/{id}/price-multiplier', access: { kind: 'permission', allOf: ['stock.manage'] } },
];
