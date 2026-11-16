import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { AppError } from '../http/errors.js';
import type { TenantContext } from '../db/tenant.js';
import type { AccessClaims, AccessTokenVerifier, SubjectType } from './jwt.js';
import { requiresFreshSession, routeOperationId } from './sensitiveRoutes.js';
import type { SessionAuthority } from './sessionAuthority.js';
import { principalToTenant } from './tenantPrincipal.js';

declare module 'fastify' {
  interface FastifyRequest {
    subject?: AccessClaims;
    tenant?: TenantContext;
    permissions?: readonly string[];
  }
  interface FastifyContextConfig {
    sensitive?: boolean;
  }
}

/** 11-10 / R12-12: typ is bound to the route group. Shared by the guard and C2. */
export function assertRouteGroupTyp(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new AppError('TOKEN_TYPE_MISMATCH', 401, 'Token type not accepted on this route group');
  }
}

export function tokenTypeMismatch(): AppError {
  return new AppError('TOKEN_TYPE_MISMATCH', 401, 'Token type not accepted on this route group');
}

/** Route-level permission gate for a `x-permission` in the frozen contract. */
export function requirePermission(request: FastifyRequest, permission: string): void {
  if (!request.permissions?.includes(permission)) {
    throw new AppError('FORBIDDEN', 403, 'Forbidden');
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export interface SubjectGuardOptions {
  sessionAuthority: SessionAuthority;
  /** Group-level fresh/PG-only check (A-11-2). Per-route `config.sensitive` also applies. */
  fresh?: boolean;
}

/** Route-group guard: JWT bound to the group, then sid / session_version / deny-set. */
export function subjectGuard(
  expected: SubjectType,
  verifier: AccessTokenVerifier,
  options: SubjectGuardOptions,
): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');

    let claims: AccessClaims;
    try {
      claims = await verifier.verify(token, expected);
    } catch {
      throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    }
    assertRouteGroupTyp(claims.typ, expected);

    const fresh = requiresFreshSession(request, options.fresh);
    const decision = await options.sessionAuthority.check(
      claims.sid,
      claims.sv,
      fresh ? { fresh: true } : undefined,
    );
    if (decision.status === 'unavailable') {
      void reply.header('retry-after', '5');
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    if (decision.status === 'inactive' && expected === 'driver') {
      throw new AppError('driver_inactive', 403, 'Driver is inactive');
    }
    if (decision.status !== 'active') {
      throw new AppError('SESSION_REVOKED', 401, 'Session revoked');
    }
    if (decision.row.accountId !== claims.sub || decision.row.typ !== claims.typ) {
      throw new AppError('SESSION_REVOKED', 401, 'Session revoked');
    }
    const operationId = routeOperationId(request);
    const scopeHeader =
      operationId === 'B3' || operationId === 'B4'
        ? undefined
        : request.headers['x-scope-distributor'];
    const resolved = principalToTenant(claims, decision.row, scopeHeader);
    request.tenant = resolved.tenant;
    request.permissions = resolved.permissions;
    request.subject = claims;
  };
}
