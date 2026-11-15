import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { subjectGuard } from '../platform/auth/guards.js';
import type { SessionAuthority } from '../platform/auth/sessionAuthority.js';
import type { AccessTokenVerifier, SubjectType } from '../platform/auth/jwt.js';
import { AppError } from '../platform/http/errors.js';
import { isAuthIssuanceRoute, isListedPublicRoute } from '../platform/http/publicRoutes.js';
import { rejectClientIdentity } from '../platform/http/rejectClientIdentity.js';
import { rejectClientPrice } from '../platform/http/rejectClientPrice.js';
import type { ModuleDefinition, RouteGroup } from '../platform/modules.js';

export interface RouteGroupOptions {
  modules: readonly ModuleDefinition[];
  verifier: AccessTokenVerifier;
  sessionAuthority: SessionAuthority;
  assertIssuance: () => Promise<void>;
}

export interface RouteGroupSpec {
  group: RouteGroup;
  prefix: `/v1/${RouteGroup}`;
  subject: SubjectType;
  /** Group-level fresh/PG check. Per-route default-deny is `SENSITIVE_OPERATION_IDS`. */
  sensitive?: boolean;
}

function requestPathOf(request: FastifyRequest): string {
  return request.url.split('?')[0] ?? '';
}

/**
 * A route group only sets prefix, guard and registration (§9.3 rule 4); routes come from modules.
 * The guard runs before every route in the group and fails closed with the deny-all verifier.
 */
export function createRouteGroup(spec: RouteGroupSpec): FastifyPluginAsync<RouteGroupOptions> {
  return async (group, { modules, verifier, sessionAuthority, assertIssuance }) => {
    const guard = subjectGuard(spec.subject, verifier, {
      sessionAuthority,
      ...(spec.sensitive === true ? { fresh: true } : {}),
    });
    group.addHook('onRequest', async function skipPublicThenGuard(request, reply) {
      const registered = request.routeOptions.url ?? '';
      const routePath = registered.startsWith(spec.prefix)
        ? registered
        : `${spec.prefix}${registered}`;
      const requestPath = requestPathOf(request);
      const registeredPath = request.routeOptions.url ?? '';
      const unregisteredDemo = registeredPath.endsWith('/*') && requestPath.endsWith('/auth/demo');
      if (!unregisteredDemo && isAuthIssuanceRoute(request.method, requestPath, spec.group)) {
        await assertIssuance();
      }
      if (
        isListedPublicRoute(request.method, requestPath) ||
        isListedPublicRoute(request.method, routePath)
      ) {
        return;
      }
      await guard.call(this, request, reply);
    });
    group.addHook('preValidation', rejectClientIdentity);
    group.addHook('preValidation', rejectClientPrice);

    for (const mod of modules) {
      const routes = mod.routes[spec.group];
      if (routes) await group.register(routes);
    }

    // Keep empty groups addressable so typ-guard behaviour is testable without domain routes.
    group.all('/*', async () => {
      throw new AppError('NOT_FOUND', 404, 'Resource not found');
    });
  };
}
