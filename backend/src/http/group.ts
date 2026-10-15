import type { FastifyPluginAsync } from 'fastify';
import { subjectGuard } from '../platform/auth/guards.js';
import type { AccessTokenVerifier, SubjectType } from '../platform/auth/jwt.js';
import { AppError } from '../platform/http/errors.js';
import { isListedPublicRoute } from '../platform/http/publicRoutes.js';
import { rejectClientIdentity } from '../platform/http/rejectClientIdentity.js';
import { rejectClientPrice } from '../platform/http/rejectClientPrice.js';
import type { ModuleDefinition, RouteGroup } from '../platform/modules.js';

export interface RouteGroupOptions {
  modules: readonly ModuleDefinition[];
  verifier: AccessTokenVerifier;
}

export interface RouteGroupSpec {
  group: RouteGroup;
  prefix: `/v1/${RouteGroup}`;
  subject: SubjectType;
}

/**
 * A route group only sets prefix, guard and registration (§9.3 rule 4); routes come from modules.
 * The guard runs before every route in the group and fails closed with the deny-all verifier.
 */
export function createRouteGroup(spec: RouteGroupSpec): FastifyPluginAsync<RouteGroupOptions> {
  return async (group, { modules, verifier }) => {
    const guard = subjectGuard(spec.subject, verifier);
    group.addHook('onRequest', async function skipPublicThenGuard(request, reply) {
      const registered = request.routeOptions.url ?? '';
      const routePath = registered.startsWith(spec.prefix)
        ? registered
        : `${spec.prefix}${registered}`;
      if (isListedPublicRoute(request.method, routePath)) return;
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
