import {
  createRouteRegistry,
  type RouteRegistry,
  type RouteRegistryRow,
} from '../platform/http/routeRegistry.js';
import { systemRouteRegistry } from '../platform/http/systemRouteRegistry.js';
import { identityRouteRegistry } from '../modules/identity/http/routeRegistry.js';
import { tenancyRouteRegistry } from '../modules/tenancy/http/routeRegistry.js';
import { customersRouteRegistry } from '../modules/customers/http/routeRegistry.js';
import { catalogRouteRegistry } from '../modules/catalog/http/routeRegistry.js';
import { orderingRouteRegistry } from '../modules/ordering/http/routeRegistry.js';
import { deliveryRouteRegistry } from '../modules/delivery/http/routeRegistry.js';
import { paymentRouteRegistry } from '../modules/payment/http/routeRegistry.js';
import { membershipRouteRegistry } from '../modules/membership/http/routeRegistry.js';
import { marketingRouteRegistry } from '../modules/marketing/http/routeRegistry.js';
import { notificationRouteRegistry } from '../modules/notification/http/routeRegistry.js';
import { reportingRouteRegistry } from '../modules/reporting/http/routeRegistry.js';

/**
 * Composition root for the default-deny registry (§ Architect #1). Module rows live in the
 * modules; `src/platform/**` never imports a module. Slice 1b maps all 139 v1.2.0 operations.
 */
export const ROUTE_REGISTRY: RouteRegistry = createRouteRegistry([
  ...systemRouteRegistry,
  ...identityRouteRegistry,
  ...tenancyRouteRegistry,
  ...customersRouteRegistry,
  ...catalogRouteRegistry,
  ...orderingRouteRegistry,
  ...deliveryRouteRegistry,
  ...paymentRouteRegistry,
  ...membershipRouteRegistry,
  ...marketingRouteRegistry,
  ...notificationRouteRegistry,
  ...reportingRouteRegistry,
]);

/** Tests may add clearly test-only rows (probe routes). Production never passes any. */
export function buildRouteRegistry(testRows: readonly RouteRegistryRow[] = []): RouteRegistry {
  return testRows.length === 0
    ? ROUTE_REGISTRY
    : createRouteRegistry([...ROUTE_REGISTRY.rows, ...testRows]);
}
