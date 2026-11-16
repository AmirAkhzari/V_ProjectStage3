import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Marketing surface (all PENDING in slice 1b). */
// prettier-ignore
export const marketingRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A41', method: 'GET', path: '/v1/app/me/coupons', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B40', method: 'GET', path: '/v1/admin/coupons', access: { kind: 'permission', allOf: ['coupons.view'] } },
  { operationId: 'B41', method: 'POST', path: '/v1/admin/coupons', access: { kind: 'permission', allOf: ['coupons.manage'] } },
  { operationId: 'B42', method: 'PUT', path: '/v1/admin/coupons/{id}', access: { kind: 'permission', allOf: ['coupons.manage'] } },
  { operationId: 'B43', method: 'DELETE', path: '/v1/admin/coupons/{id}', access: { kind: 'permission', allOf: ['coupons.manage'] } },
  { operationId: 'B44', method: 'GET', path: '/v1/admin/banners', access: { kind: 'permission', allOf: ['banners.manage'] } },
  { operationId: 'B45', method: 'POST', path: '/v1/admin/banners', access: { kind: 'permission', allOf: ['banners.manage'] } },
  { operationId: 'B46', method: 'PUT', path: '/v1/admin/banners/{id}', access: { kind: 'permission', allOf: ['banners.manage'] } },
  { operationId: 'B48', method: 'DELETE', path: '/v1/admin/banners/{id}', access: { kind: 'permission', allOf: ['banners.manage'] } },
  { operationId: 'B47', method: 'PUT', path: '/v1/admin/banners/order', access: { kind: 'permission', allOf: ['banners.manage'] } },
  { operationId: 'B49', method: 'GET', path: '/v1/admin/messages', access: { kind: 'permission', allOf: ['messages.send'] } },
  { operationId: 'B50', method: 'POST', path: '/v1/admin/messages', access: { kind: 'permission', allOf: ['messages.send'] } },
];
