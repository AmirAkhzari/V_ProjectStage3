import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Identity surface. A5/B5 are registered only when demo login is enabled (`demoLoginEnabled()`). */
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
    demo: true,
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
    // Architect L-3-2: logout must always work. B4 is an explicit second exception to the
    // must-change-password block; the contract's exception is otherwise C11-only (AppSec P3-3).
    access: { kind: 'authenticated', subject: 'staff', allowMustChangePassword: true },
  },
  {
    operationId: 'B5',
    method: 'POST',
    path: '/v1/admin/auth/demo',
    access: { kind: 'public' },
    demo: true,
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
