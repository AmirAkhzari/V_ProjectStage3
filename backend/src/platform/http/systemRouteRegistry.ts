import type { RouteRegistryRow } from './routeRegistry.js';

/** System routes live outside the three API groups but still need registry rows. */
export const systemRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'S1', method: 'GET', path: '/health', access: { kind: 'public' } },
  { operationId: 'S2', method: 'GET', path: '/ready', access: { kind: 'public' } },
];
