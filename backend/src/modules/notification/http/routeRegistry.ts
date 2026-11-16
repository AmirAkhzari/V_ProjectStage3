import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Notification surface (all PENDING in slice 1b). */
// prettier-ignore
export const notificationRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A39', method: 'GET', path: '/v1/app/me/notifications', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A40', method: 'POST', path: '/v1/app/me/notifications/read', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B71', method: 'GET', path: '/v1/admin/notifications', access: { kind: 'authenticated', subject: 'staff' } },
  { operationId: 'B72', method: 'POST', path: '/v1/admin/notifications/read', access: { kind: 'authenticated', subject: 'staff' } },
  { operationId: 'C9', method: 'GET', path: '/v1/driver/notifications', access: { kind: 'authenticated', subject: 'driver' } },
  { operationId: 'C10', method: 'POST', path: '/v1/driver/notifications/read', access: { kind: 'authenticated', subject: 'driver' } },
];
