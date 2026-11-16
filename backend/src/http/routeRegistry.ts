import {
  createRouteRegistry,
  type RouteRegistry,
  type RouteRegistryRow,
} from '../platform/http/routeRegistry.js';
import { systemRouteRegistry } from '../platform/http/systemRouteRegistry.js';
import { identityRouteRegistry } from '../modules/identity/http/routeRegistry.js';
import { paymentRouteRegistry } from '../modules/payment/http/routeRegistry.js';
import { tenancyRouteRegistry } from '../modules/tenancy/http/routeRegistry.js';

/**
 * Composition root for the default-deny registry (§ Architect #1). Module rows live in the
 * modules; `src/platform/**` never imports a module. Assembly throws on duplicate ids/routes.
 * Slice 1a only contains the ~15 operations currently registered; the rest is slice 1b.
 */
export const ROUTE_REGISTRY: RouteRegistry = createRouteRegistry([
  ...systemRouteRegistry,
  ...identityRouteRegistry,
  ...tenancyRouteRegistry,
  ...paymentRouteRegistry,
]);

/** Tests may add clearly test-only rows (probe routes). Production never passes any. */
export function buildRouteRegistry(testRows: readonly RouteRegistryRow[] = []): RouteRegistry {
  return testRows.length === 0
    ? ROUTE_REGISTRY
    : createRouteRegistry([...ROUTE_REGISTRY.rows, ...testRows]);
}
