import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { subjectGuard } from '../platform/auth/guards.js';
import type { AccessTokenVerifier, SubjectType } from '../platform/auth/jwt.js';
import { routeOperationId } from '../platform/auth/sensitiveRoutes.js';
import type { SessionAuthority } from '../platform/auth/sessionAuthority.js';
import { AppError } from '../platform/http/errors.js';
import { isAuthIssuanceRoute } from '../platform/http/publicRoutes.js';
import { rejectClientIdentity } from '../platform/http/rejectClientIdentity.js';
import { rejectClientPrice } from '../platform/http/rejectClientPrice.js';
import {
  decideRouteAccess,
  logGuardFailure,
  logRouteDeny,
  principalOf,
  routeAccessError,
} from '../platform/http/routeAccess.js';
import {
  catchAllRouteConfig,
  installRouteRegistryHook,
  isCatchAllRoute,
  isPublicRegistryRoute,
  type RouteRegistry,
} from '../platform/http/routeRegistry.js';
import type { ModuleDefinition, RouteGroup } from '../platform/modules.js';

export interface RouteGroupOptions {
  modules: readonly ModuleDefinition[];
  verifier: AccessTokenVerifier;
  sessionAuthority: SessionAuthority;
  assertIssuance: () => Promise<void>;
  /** Default-deny registry for build-time binding and the onRequest access check. */
  registry: RouteRegistry;
  /** Registered inside this group, before the catch-all. Tests use it for probes. */
  extraRoutes?: FastifyPluginAsync;
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
 * L-5-1 / P5-4: PII-bearing operations that must never be cached by a browser or proxy.
 * Keyed on the exact registered operationId (never a path suffix) so an auto-HEAD for a GET
 * op is covered by Fastify copying the GET operationId.
 */
const NO_STORE_OPERATION_IDS: ReadonlySet<string> = new Set([
  'A7',
  'A8',
  'A9',
  'A10',
  'A11',
  'A12',
  'A13',
  'A14',
  'A16',
  'A17',
  'A18',
  'C11',
  'B83',
]);

/**
 * A route group only sets prefix, guard and registration (§9.3 rule 4); routes come from modules.
 * The guard runs before every route in the group and fails closed with the deny-all verifier.
 *
 * Order is onRequest: authenticate (typ + session snapshot) → access from the registry row.
 * onRoute already refused to boot any route whose operationId is missing or unmapped.
 */
export function createRouteGroup(spec: RouteGroupSpec): FastifyPluginAsync<RouteGroupOptions> {
  return async (
    group,
    { modules, verifier, sessionAuthority, assertIssuance, registry, extraRoutes },
  ) => {
    installRouteRegistryHook(group, registry);
    const guard = subjectGuard(spec.subject, verifier, {
      sessionAuthority,
      ...(spec.sensitive === true ? { fresh: true } : {}),
    });
    // A7–A17/C11 carry PII or credentials: no-store must also cover guard (401/403) and handler
    // (404/422) responses, so it is set before the guard and before the handler.
    group.addHook('onRequest', async function noStorePrivateRoutes(request, reply) {
      const operationId = routeOperationId(request);
      if (operationId !== undefined && NO_STORE_OPERATION_IDS.has(operationId)) {
        void reply.header('cache-control', 'no-store');
      }
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
      // L-3-4: the public skip is the registry row, not a module-settable flag.
      if (
        isPublicRegistryRoute(registry, request.method, requestPath) ||
        isPublicRegistryRoute(registry, request.method, routePath)
      ) {
        return;
      }
      const operationId = routeOperationId(request);
      try {
        await guard.call(this, request, reply);
      } catch (error) {
        logGuardFailure(request, error, operationId);
        throw error;
      }
      // P3-2a: after auth, only the group's own catch-all may lack an operationId.
      if (operationId === undefined) {
        const config = request.routeOptions.config as unknown as
          Record<string | symbol, unknown> | undefined;
        if (isCatchAllRoute(config, routePath)) return;
        throw new AppError('FORBIDDEN', 403, 'Forbidden');
      }
      const decision = decideRouteAccess(
        registry.byOperationId.get(operationId),
        principalOf(request),
      );
      if (!decision.allow) {
        logRouteDeny(request, {
          operationId,
          reasonCode: decision.reason,
          statusCode: 403,
        });
        throw routeAccessError(decision);
      }
    });
    group.addHook('preValidation', rejectClientIdentity);
    group.addHook('preValidation', rejectClientPrice);

    for (const mod of modules) {
      const routes = mod.routes[spec.group];
      if (routes) await group.register(routes);
    }
    if (extraRoutes) await group.register(extraRoutes);

    // Keep empty groups addressable so typ-guard behaviour is testable without domain routes.
    group.all('/*', catchAllRouteConfig(), async () => {
      throw new AppError('NOT_FOUND', 404, 'Resource not found');
    });
  };
}
