export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface PublicRoute {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/v1/payments/callback/{provider}`. */
  path: string;
}

/**
 * Canonical public allowlist (L-2). Equal to the frozen contract's `x-permission: public`
 * operations. Route groups must not skip the subject guard based on a flag a module can set;
 * only this list (plus the system plugin for S1/S2) is public. Auth endpoints are listed here
 * for the contract test and are not registered in Foundation.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { operationId: 'A1', method: 'POST', path: '/v1/app/auth/otp/send' },
  { operationId: 'A2', method: 'POST', path: '/v1/app/auth/otp/verify' },
  { operationId: 'A3', method: 'POST', path: '/v1/app/auth/refresh' },
  { operationId: 'A4', method: 'POST', path: '/v1/app/auth/logout' },
  { operationId: 'A5', method: 'POST', path: '/v1/app/auth/demo' },
  { operationId: 'B1', method: 'POST', path: '/v1/admin/auth/otp/send' },
  { operationId: 'B2', method: 'POST', path: '/v1/admin/auth/otp/verify' },
  { operationId: 'B3', method: 'POST', path: '/v1/admin/auth/refresh' },
  { operationId: 'B5', method: 'POST', path: '/v1/admin/auth/demo' },
  { operationId: 'C1', method: 'POST', path: '/v1/driver/auth/login' },
  { operationId: 'C2', method: 'POST', path: '/v1/driver/auth/refresh' },
  { operationId: 'S1', method: 'GET', path: '/health' },
  { operationId: 'S2', method: 'GET', path: '/ready' },
  { operationId: 'S3', method: 'POST', path: '/v1/payments/callback/{provider}' },
];

export const PUBLIC_OPERATION_IDS: ReadonlySet<string> = new Set(
  PUBLIC_ROUTES.map((r) => r.operationId),
);
