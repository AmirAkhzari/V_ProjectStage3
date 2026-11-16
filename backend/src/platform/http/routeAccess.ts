import type { FastifyRequest } from 'fastify';
import type { StaffRole } from '../auth/sessionAuthority.js';
import { AppError } from './errors.js';
import { isUsablePermissionRule, type RouteRegistryRow } from './routeRegistry.js';

export type AccessDenyReason =
  'unmapped_route' | 'missing_permission' | 'not_super_admin' | 'password_change_required';

export type AccessDecision =
  | { allow: true }
  | { allow: false; reason: AccessDenyReason; code: 'FORBIDDEN' | 'PASSWORD_CHANGE_REQUIRED' };

/** Everything the access check may read: the server-side session snapshot, never the request. */
export interface RoutePrincipal {
  permissions: readonly string[];
  staffRole: StaffRole | null;
  mustChangePassword: boolean;
}

export function principalOf(request: FastifyRequest): RoutePrincipal {
  return {
    permissions: request.permissions ?? [],
    staffRole: request.staffRole ?? null,
    mustChangePassword: request.mustChangePassword === true,
  };
}

/**
 * Pure access decision. `public` rows are normally skipped before the guard runs; this
 * function still treats them as allow. A missing row fails closed.
 */
export function decideRouteAccess(
  row: RouteRegistryRow | undefined,
  principal: RoutePrincipal,
): AccessDecision {
  if (!row) return { allow: false, reason: 'unmapped_route', code: 'FORBIDDEN' };
  const access = row.access;
  if (access.kind === 'public') return { allow: true };

  if (
    principal.mustChangePassword &&
    !(access.kind === 'authenticated' && access.allowMustChangePassword === true)
  ) {
    return { allow: false, reason: 'password_change_required', code: 'PASSWORD_CHANGE_REQUIRED' };
  }

  switch (access.kind) {
    case 'authenticated':
      // The group already bound `typ`; the snapshot typ was checked against the claims.
      return { allow: true };
    case 'permission': {
      // Malformed rule (no non-empty anyOf/allOf) fails closed instead of passing vacuously.
      if (!isUsablePermissionRule(access)) {
        return { allow: false, reason: 'missing_permission', code: 'FORBIDDEN' };
      }
      const has = (code: string): boolean => principal.permissions.includes(code);
      if (access.allOf !== undefined && !access.allOf.every(has)) {
        return { allow: false, reason: 'missing_permission', code: 'FORBIDDEN' };
      }
      if (access.anyOf !== undefined && access.anyOf.length > 0 && !access.anyOf.some(has)) {
        return { allow: false, reason: 'missing_permission', code: 'FORBIDDEN' };
      }
      return { allow: true };
    }
    case 'role':
      return principal.staffRole === access.role
        ? { allow: true }
        : { allow: false, reason: 'not_super_admin', code: 'FORBIDDEN' };
  }
}

export function routeAccessError(decision: AccessDecision): AppError {
  if (decision.allow) throw new Error('routeAccessError called for an allowed decision');
  return decision.code === 'PASSWORD_CHANGE_REQUIRED'
    ? new AppError('PASSWORD_CHANGE_REQUIRED', 403, 'Password change required')
    : new AppError('FORBIDDEN', 403, 'Forbidden');
}

export interface DenyLogInput {
  operationId?: string | undefined;
  reasonCode: string;
  statusCode: number;
}

/**
 * AppSec #8: one structured deny log with request id, operation id, subject id/role and a
 * reason code. Never tokens, OTPs, phone numbers or bodies; pino redaction still applies.
 */
export function logRouteDeny(request: FastifyRequest, input: DenyLogInput): void {
  request.log.warn(
    {
      event: 'route_access_denied',
      requestId: request.id,
      operationId: input.operationId ?? null,
      subjectId: request.subject?.sub ?? null,
      subjectType: request.subject?.typ ?? null,
      staffRole: request.staffRole ?? null,
      decision: 'deny',
      reasonCode: input.reasonCode,
      statusCode: input.statusCode,
    },
    'route access denied',
  );
}

/** Log 401/403 guard failures (typ mismatch, revoked session) without their payloads. */
export function logGuardFailure(
  request: FastifyRequest,
  error: unknown,
  operationId: string | undefined,
): void {
  if (!(error instanceof AppError)) return;
  if (error.statusCode !== 401 && error.statusCode !== 403) return;
  logRouteDeny(request, {
    operationId,
    reasonCode: error.code,
    statusCode: error.statusCode,
  });
}
