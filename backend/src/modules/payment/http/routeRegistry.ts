import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/**
 * Payment surface. S3 is a frozen public callback but is not registered yet (the catch-all
 * still 404s); the registry row exists so the public allowlist stays one source of truth.
 */
export const paymentRouteRegistry: readonly RouteRegistryRow[] = [
  {
    operationId: 'S3',
    method: 'POST',
    path: '/v1/payments/callback/{provider}',
    access: { kind: 'public' },
  },
];
