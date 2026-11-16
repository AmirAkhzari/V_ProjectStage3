import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Delivery surface. B80 is dev-only and stays unregistered until a later slice. */
// prettier-ignore
export const deliveryRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A20', method: 'GET', path: '/v1/app/distributors/{id}/slots', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B10', method: 'PUT', path: '/v1/admin/orders/{id}/driver', access: { kind: 'permission', allOf: ['deliveries.assign'] } },
  { operationId: 'B54', method: 'GET', path: '/v1/admin/distributors/{id}/slots', access: { kind: 'permission', allOf: ['delivery.manage'] } },
  { operationId: 'B55', method: 'PUT', path: '/v1/admin/distributors/{id}/slots', access: { kind: 'permission', allOf: ['delivery.manage'] } },
  { operationId: 'B56', method: 'GET', path: '/v1/admin/distributors/{id}/capacity', access: { kind: 'permission', allOf: ['delivery.manage'] } },
  { operationId: 'B57', method: 'PUT', path: '/v1/admin/distributors/{id}/capacity/{date}', access: { kind: 'permission', allOf: ['delivery.manage'] } },
  { operationId: 'B58', method: 'GET', path: '/v1/admin/vehicles', access: { kind: 'permission', allOf: ['drivers.view'] } },
  { operationId: 'B59', method: 'POST', path: '/v1/admin/vehicles', access: { kind: 'permission', allOf: ['drivers.manage'] } },
  { operationId: 'B60', method: 'PUT', path: '/v1/admin/vehicles/{id}', access: { kind: 'permission', allOf: ['drivers.manage'] } },
  { operationId: 'B61', method: 'GET', path: '/v1/admin/drivers', access: { kind: 'permission', allOf: ['drivers.view'] } },
  { operationId: 'B63', method: 'POST', path: '/v1/admin/drivers', access: { kind: 'permission', allOf: ['drivers.manage'] } },
  { operationId: 'B62', method: 'GET', path: '/v1/admin/drivers/{id}', access: { kind: 'permission', allOf: ['drivers.view'] } },
  { operationId: 'B64', method: 'PATCH', path: '/v1/admin/drivers/{id}', access: { kind: 'permission', allOf: ['drivers.manage'] } },
  { operationId: 'B66', method: 'PUT', path: '/v1/admin/drivers/{id}/route', access: { kind: 'permission', allOf: ['deliveries.assign'] } },
  { operationId: 'B67', method: 'POST', path: '/v1/admin/drivers/{id}/dispatch', access: { kind: 'permission', allOf: ['orders.update'] } },
  { operationId: 'B68', method: 'GET', path: '/v1/admin/deliveries', access: { kind: 'permission', allOf: ['orders.view'] } },
  { operationId: 'B69', method: 'POST', path: '/v1/admin/deliveries/{id}/confirm', access: { kind: 'permission', allOf: ['deliveries.confirm'] } },
  { operationId: 'B70', method: 'POST', path: '/v1/admin/deliveries/{id}/reject', access: { kind: 'permission', allOf: ['deliveries.confirm'] } },
  { operationId: 'B80', method: 'POST', path: '/v1/admin/dev/deliveries/{id}/simulate-verification', access: { kind: 'role', role: 'super_admin' }, demo: true },
  { operationId: 'B81', method: 'POST', path: '/v1/admin/deliveries/{id}/cancel', access: { kind: 'permission', allOf: ['deliveries.assign'] } },
  { operationId: 'C4', method: 'GET', path: '/v1/driver/me', access: { kind: 'authenticated', subject: 'driver' } },
  { operationId: 'C5', method: 'GET', path: '/v1/driver/today', access: { kind: 'authenticated', subject: 'driver' } },
  { operationId: 'C6', method: 'GET', path: '/v1/driver/deliveries', access: { kind: 'authenticated', subject: 'driver' } },
  { operationId: 'C7', method: 'GET', path: '/v1/driver/deliveries/{id}', access: { kind: 'authenticated', subject: 'driver' } },
  { operationId: 'C8', method: 'POST', path: '/v1/driver/deliveries/{id}/verification', access: { kind: 'authenticated', subject: 'driver' } },
];
