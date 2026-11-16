import type { RouteRegistryRow } from '../../../platform/http/routeRegistry.js';

/** Identity surface. A5/B5 are registered only when demo login is enabled (`demoLoginEnabled()`). */
// prettier-ignore
export const identityRouteRegistry: readonly RouteRegistryRow[] = [
  { operationId: 'A1', method: 'POST', path: '/v1/app/auth/otp/send', access: { kind: 'public' } },
  { operationId: 'A2', method: 'POST', path: '/v1/app/auth/otp/verify', access: { kind: 'public' } },
  { operationId: 'A3', method: 'POST', path: '/v1/app/auth/refresh', access: { kind: 'public' } },
  { operationId: 'A4', method: 'POST', path: '/v1/app/auth/logout', access: { kind: 'public' } },
  { operationId: 'A5', method: 'POST', path: '/v1/app/auth/demo', access: { kind: 'public' }, demo: true },
  { operationId: 'B1', method: 'POST', path: '/v1/admin/auth/otp/send', access: { kind: 'public' } },
  { operationId: 'B2', method: 'POST', path: '/v1/admin/auth/otp/verify', access: { kind: 'public' } },
  { operationId: 'B3', method: 'POST', path: '/v1/admin/auth/refresh', access: { kind: 'public' } },
  // Architect L-3-2: logout must always work; B4 is the approved second must-change exception.
  { operationId: 'B4', method: 'POST', path: '/v1/admin/auth/logout', access: { kind: 'authenticated', subject: 'staff', allowMustChangePassword: true } },
  { operationId: 'B5', method: 'POST', path: '/v1/admin/auth/demo', access: { kind: 'public' }, demo: true },
  { operationId: 'B65', method: 'POST', path: '/v1/admin/drivers/{id}/password', access: { kind: 'permission', allOf: ['drivers.manage'] } },
  { operationId: 'B75', method: 'GET', path: '/v1/admin/staff', access: { kind: 'permission', allOf: ['staff.manage'] } },
  { operationId: 'B76', method: 'POST', path: '/v1/admin/staff', access: { kind: 'permission', allOf: ['staff.manage'] } },
  { operationId: 'B77', method: 'PUT', path: '/v1/admin/staff/{id}', access: { kind: 'permission', allOf: ['staff.manage'] } },
  { operationId: 'B83', method: 'POST', path: '/v1/admin/drivers/{id}/unlock', access: { kind: 'permission', allOf: ['drivers.manage'] } },
  { operationId: 'C1', method: 'POST', path: '/v1/driver/auth/login', access: { kind: 'public' } },
  { operationId: 'C2', method: 'POST', path: '/v1/driver/auth/refresh', access: { kind: 'public' } },
  { operationId: 'C3', method: 'POST', path: '/v1/driver/auth/logout', access: { kind: 'authenticated', subject: 'driver' } },
  // C11 is the contract's must-change exception; P3-6d keeps C3 without the flag.
  { operationId: 'C11', method: 'POST', path: '/v1/driver/auth/password', access: { kind: 'authenticated', subject: 'driver', allowMustChangePassword: true } },
];
