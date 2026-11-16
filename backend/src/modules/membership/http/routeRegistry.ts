import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Membership surface (all PENDING in slice 1b). */
// prettier-ignore
export const membershipRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A14', method: 'GET', path: '/v1/app/me/subscription', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A15', method: 'POST', path: '/v1/app/me/subscription/checkout', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B38', method: 'POST', path: '/v1/admin/retailers/{id}/subscription', access: { kind: 'permission', allOf: ['subscriptions.manage'] } },
  { operationId: 'B39', method: 'GET', path: '/v1/admin/subscriptions', access: { kind: 'permission', allOf: ['subscriptions.manage'] } },
];
