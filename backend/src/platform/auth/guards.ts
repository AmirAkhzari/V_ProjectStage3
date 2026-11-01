import type { onRequestAsyncHookHandler } from 'fastify';
import { AppError } from '../http/errors.js';
import type { TenantContext } from '../db/tenant.js';
import type { AccessClaims, AccessTokenVerifier, SubjectType } from './jwt.js';
import type { SessionAuthority } from './sessionAuthority.js';
import { principalToTenant } from './tenantPrincipal.js';

declare module 'fastify' {
  interface FastifyRequest {
    subject?: AccessClaims;
    tenant?: TenantContext;
    permissions?: readonly string[];
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export interface SubjectGuardOptions {
  sessionAuthority?: SessionAuthority;
}

/** Route-group guard: JWT bound to the group, then sid / session_version / deny-set. */
export function subjectGuard(
  expected: SubjectType,
  verifier: AccessTokenVerifier,
  options: SubjectGuardOptions = {},
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
    if (claims.typ !== expected) {
      throw new AppError('TOKEN_TYPE_MISMATCH', 401, 'Token type not accepted on this route group');
    }

    if (options.sessionAuthority) {
      const decision = await options.sessionAuthority.check(claims.sid, claims.sv);
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
      const resolved = principalToTenant(
        claims,
        decision.row,
        request.headers['x-scope-distributor'],
      );
      request.tenant = resolved.tenant;
      request.permissions = resolved.permissions;
    }

    request.subject = claims;
  };
}
