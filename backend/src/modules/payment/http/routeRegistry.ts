import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Payment surface. S3 is a frozen public callback but stays unregistered (catch-all 404). */
// prettier-ignore
export const paymentRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A34', method: 'GET', path: '/v1/app/payments/{id}', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A35', method: 'POST', path: '/v1/app/payments/{id}/mock-complete', access: { kind: 'authenticated', subject: 'shopkeeper' }, demo: true },
  { operationId: 'A36', method: 'POST', path: '/v1/app/payments/{id}/start', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A37', method: 'GET', path: '/v1/app/me/wallet', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A38', method: 'POST', path: '/v1/app/me/wallet/topups', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'A42', method: 'GET', path: '/v1/app/payments/{id}/refund', access: { kind: 'authenticated', subject: 'shopkeeper' } },
  { operationId: 'B51', method: 'GET', path: '/v1/admin/payments', access: { kind: 'permission', allOf: ['finance.view'] } },
  { operationId: 'B52', method: 'GET', path: '/v1/admin/wallets', access: { kind: 'permission', allOf: ['finance.view'] } },
  { operationId: 'B53', method: 'POST', path: '/v1/admin/wallets/{retailerId}/adjust', access: { kind: 'permission', allOf: ['finance.adjust'] } },
  { operationId: 'B82', method: 'GET', path: '/v1/admin/payments/refunds', access: { kind: 'permission', allOf: ['finance.view'] } },
  { operationId: 'S3', method: 'POST', path: '/v1/payments/callback/{provider}', access: { kind: 'public' } },
];
