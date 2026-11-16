import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Identity surface. A5/B5 are registered only when demo login is enabled (`non-prod`). */
export const identityRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A1', method: 'POST', path: '/v1/app/auth/otp/send', access: { kind: 'public' } },
  {
    operationId: 'A2',
    method: 'POST',
    path: '/v1/app/auth/otp/verify',
    access: { kind: 'public' },
  },
  { operationId: 'A3', method: 'POST', path: '/v1/app/auth/refresh', access: { kind: 'public' } },
  { operationId: 'A4', method: 'POST', path: '/v1/app/auth/logout', access: { kind: 'public' } },
  {
    operationId: 'A5',
    method: 'POST',
    path: '/v1/app/auth/demo',
    access: { kind: 'public' },
    env: 'non-prod',
  },
  {
    operationId: 'B1',
    method: 'POST',
    path: '/v1/admin/auth/otp/send',
    access: { kind: 'public' },
  },
  {
    operationId: 'B2',
    method: 'POST',
    path: '/v1/admin/auth/otp/verify',
    access: { kind: 'public' },
  },
  { operationId: 'B3', method: 'POST', path: '/v1/admin/auth/refresh', access: { kind: 'public' } },
  {
    operationId: 'B4',
    method: 'POST',
    path: '/v1/admin/auth/logout',
    access: { kind: 'authenticated', subject: 'staff' },
  },
  {
    operationId: 'B5',
    method: 'POST',
    path: '/v1/admin/auth/demo',
    access: { kind: 'public' },
    env: 'non-prod',
  },
  {
    operationId: 'C1',
    method: 'POST',
    path: '/v1/driver/auth/login',
    access: { kind: 'public' },
  },
  {
    operationId: 'C2',
    method: 'POST',
    path: '/v1/driver/auth/refresh',
    access: { kind: 'public' },
  },
];
