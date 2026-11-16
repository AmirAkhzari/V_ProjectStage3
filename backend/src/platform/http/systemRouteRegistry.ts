import type { RouteRegistryRow } from './routeRegistry.js';

/** Platform-owned rows. B79 is dev-only and stays unregistered until a later slice. */
// prettier-ignore
export const systemRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'S1', method: 'GET', path: '/health', access: { kind: 'public' } },
  { operationId: 'S2', method: 'GET', path: '/ready', access: { kind: 'public' } },
  { operationId: 'A6', method: 'GET', path: '/v1/app/config', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B73', method: 'GET', path: '/v1/admin/settings', access: { kind: 'permission', allOf: ['settings.manage'] } },
  { operationId: 'B74', method: 'PUT', path: '/v1/admin/settings', access: { kind: 'permission', allOf: ['settings.manage'] } },
  { operationId: 'B78', method: 'GET', path: '/v1/admin/audit', access: { kind: 'permission', allOf: ['audit.view'] } },
  { operationId: 'B79', method: 'POST', path: '/v1/admin/dev/reset-demo', access: { kind: 'role', role: 'super_admin' }, demo: true },
];
