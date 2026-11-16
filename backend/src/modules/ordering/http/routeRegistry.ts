import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Ordering surface (all PENDING in slice 1b). B9 uses anyOf per x-permission. */
// prettier-ignore
export const orderingRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A24', method: 'GET', path: '/v1/app/cart', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A26', method: 'PATCH', path: '/v1/app/cart', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A28', method: 'DELETE', path: '/v1/app/cart', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A25', method: 'POST', path: '/v1/app/cart/items', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A27', method: 'POST', path: '/v1/app/cart/switch-distributor', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A29', method: 'POST', path: '/v1/app/checkout/quote', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A30', method: 'POST', path: '/v1/app/checkout', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A31', method: 'GET', path: '/v1/app/me/orders', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A32', method: 'GET', path: '/v1/app/me/orders/{id}', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A33', method: 'POST', path: '/v1/app/me/orders/{id}/cancel', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B7', method: 'GET', path: '/v1/admin/orders', access: { kind: 'permission', allOf: ['orders.view'] } },
  { operationId: 'B8', method: 'GET', path: '/v1/admin/orders/{id}', access: { kind: 'permission', allOf: ['orders.view'] } },
  { operationId: 'B9', method: 'POST', path: '/v1/admin/orders/{id}/transition', access: { kind: 'permission', anyOf: ['orders.update', 'orders.cancel', 'orders.deliver_manual'] } },
  { operationId: 'B37', method: 'GET', path: '/v1/admin/retailers/{id}/orders', access: { kind: 'permission', allOf: ['retailers.view'] } },
];
