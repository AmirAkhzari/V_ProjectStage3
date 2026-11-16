import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Reporting surface (all PENDING in slice 1b). */
// prettier-ignore
export const reportingRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'B6', method: 'GET', path: '/v1/admin/dashboard', access: { kind: 'permission', allOf: ['dashboard.view'] } },
];
