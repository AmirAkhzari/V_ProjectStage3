import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Tenancy surface. B25 stays permission-gated here and in its handler (defense in depth). */
export const tenancyRouteRegistry: readonly RouteRegistryRow[] = [
  {
    operationId: 'B25',
    method: 'GET',
    path: '/v1/admin/distributors/{id}',
    access: { kind: 'permission', allOf: ['distributors.view'] },
  },
];
