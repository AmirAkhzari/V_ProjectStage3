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

export function isListedPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((route) => route.method === method && route.path === path);
}

/** AUTH-AV-01 / SESS-05 issuance paths, including C11 which is not public. */
export const AUTH_ISSUANCE_PATHS: readonly { method: HttpMethod; path: string }[] = [
  { method: 'POST', path: '/v1/app/auth/otp/send' },
  { method: 'POST', path: '/v1/app/auth/otp/verify' },
  { method: 'POST', path: '/v1/admin/auth/otp/send' },
  { method: 'POST', path: '/v1/admin/auth/otp/verify' },
  { method: 'POST', path: '/v1/driver/auth/login' },
  { method: 'POST', path: '/v1/driver/auth/password' },
  { method: 'POST', path: '/v1/app/auth/demo' },
  { method: 'POST', path: '/v1/admin/auth/demo' },
];

export function isAuthIssuanceRoute(
  method: string,
  path: string,
  group?: 'app' | 'admin' | 'driver',
): boolean {
  if (method !== 'POST') return false;
  if (group === 'driver' || path.startsWith('/v1/driver/')) {
    return path.endsWith('/auth/login') || path.endsWith('/auth/password');
  }
  if (group === 'app' || path.startsWith('/v1/app/')) {
    return (
      path.endsWith('/auth/otp/send') ||
      path.endsWith('/auth/otp/verify') ||
      path.endsWith('/auth/demo')
    );
  }
  if (group === 'admin' || path.startsWith('/v1/admin/')) {
    return (
      path.endsWith('/auth/otp/send') ||
      path.endsWith('/auth/otp/verify') ||
      path.endsWith('/auth/demo')
    );
  }
  return AUTH_ISSUANCE_PATHS.some((route) => route.method === method && route.path === path);
}
