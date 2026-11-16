import type { FastifyInstance } from 'fastify';
import type { PermissionCode } from '../auth/permissionCodes.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** The three API surfaces, matching `AccessClaims.typ`. */
export type RouteSubject = 'shopkeeper' | 'staff' | 'driver';

/**
 * Exactly one access rule per registry row. `super_admin` is never an implicit pass:
 * it succeeds only through `role` or because the session snapshot carries the codes.
 */
export type RouteAccess =
  | { kind: 'public' }
  | {
      kind: 'authenticated';
      subject: RouteSubject;
      allowMustChangePassword?: boolean;
    }
  | { kind: 'permission'; anyOf?: PermissionCode[]; allOf?: PermissionCode[] }
  | { kind: 'role'; role: 'super_admin' };

export interface RouteRegistryRow {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/v1/admin/distributors/{id}`. */
  path: string;
  access: RouteAccess;
  /**
   * Informational only (L-3-1): marks the A5/B5 demo-login ops. Not enforced by the registry;
   * registration stays gated at boot by `demoLoginEnabled()`.
   */
  demo?: true;
}

export interface RouteRegistry {
  readonly rows: readonly RouteRegistryRow[];
  readonly byOperationId: ReadonlyMap<string, RouteRegistryRow>;
}

/** The only routes allowed to register without an operationId (three group catch-alls). */
export const INFRA_CATCH_ALL_PATHS: ReadonlySet<string> = new Set([
  '/v1/app/*',
  '/v1/admin/*',
  '/v1/driver/*',
]);

/** Fastify `/distributors/:id` → OpenAPI `/distributors/{id}`. */
export function toOpenApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * A permission rule is usable only when at least one of `anyOf` / `allOf` is present and
 * non-empty; otherwise it would be vacuous (empty `allOf` passes `[].every`).
 */
export function isUsablePermissionRule(access: RouteAccess): boolean {
  if (access.kind !== 'permission') return true;
  const anyOf = access.anyOf !== undefined && access.anyOf.length > 0;
  const allOf = access.allOf !== undefined && access.allOf.length > 0;
  return anyOf || allOf;
}

/** Fails closed on duplicates and vacuous permission rules; called at assembly and by tests. */
export function createRouteRegistry(rows: readonly RouteRegistryRow[]): RouteRegistry {
  const byOperationId = new Map<string, RouteRegistryRow>();
  const byRoute = new Set<string>();
  for (const row of rows) {
    if (row.operationId.length === 0) {
      throw new Error('route registry: row with an empty operationId');
    }
    if (byOperationId.has(row.operationId)) {
      throw new Error(`route registry: duplicate operationId ${row.operationId}`);
    }
    const routeKey = `${row.method} ${row.path}`;
    if (byRoute.has(routeKey)) {
      throw new Error(`route registry: duplicate route ${routeKey}`);
    }
    if (!isUsablePermissionRule(row.access)) {
      throw new Error(
        `route registry: ${row.operationId} has a permission rule with no usable anyOf/allOf codes`,
      );
    }
    byOperationId.set(row.operationId, row);
    byRoute.add(routeKey);
  }
  return { rows: [...rows], byOperationId };
}

/** Structural subset of Fastify's onRoute payload that this check needs. */
export interface OnRoutePayload {
  method: string | string[];
  url: string;
  schema?: { operationId?: unknown } | undefined;
}

function methodMatches(registered: string, rowMethod: HttpMethod): boolean {
  if (registered === rowMethod) return true;
  // Fastify exposes a HEAD route for every GET (exposeHeadRoutes defaults to true).
  return registered === 'HEAD' && rowMethod === 'GET';
}

/**
 * Build-time default-deny. Every route must carry an operationId with a registry row whose
 * method and path match. Throws (never returns "allow") so an unmapped route cannot boot.
 */
export function assertRouteRegistered(payload: OnRoutePayload, registry: RouteRegistry): void {
  const methods = Array.isArray(payload.method) ? payload.method : [payload.method];
  const path = toOpenApiPath(payload.url);
  const rawOperationId = payload.schema?.operationId;
  const operationId = typeof rawOperationId === 'string' ? rawOperationId : undefined;

  if (operationId === undefined || operationId.length === 0) {
    if (INFRA_CATCH_ALL_PATHS.has(path)) return;
    throw new Error(
      `route registry: ${methods.join(',')} ${path} is registered without an operationId`,
    );
  }

  const row = registry.byOperationId.get(operationId);
  if (!row) {
    throw new Error(
      `route registry: ${operationId} (${methods.join(',')} ${path}) has no registry row`,
    );
  }
  if (row.path !== path) {
    throw new Error(
      `route registry: ${operationId} is registered at ${path} but the registry row is ${row.path}`,
    );
  }
  for (const method of methods) {
    if (!methodMatches(method, row.method)) {
      throw new Error(
        `route registry: ${operationId} registered as ${method} ${path} but the registry row is ${row.method}`,
      );
    }
  }
}

const HOOK_INSTALLED = Symbol.for('vproject.routeRegistryHook');

/**
 * Installs the onRoute check. Idempotent: a Fastify child instance inherits the marker
 * through `Object.create`, so `createRouteGroup` does not re-add a hook buildApp installed.
 */
export function installRouteRegistryHook(app: FastifyInstance, registry: RouteRegistry): void {
  const tagged = app as FastifyInstance & { [HOOK_INSTALLED]?: boolean };
  if (tagged[HOOK_INSTALLED] === true) return;
  app.addHook('onRoute', (route) => {
    assertRouteRegistered(route as unknown as OnRoutePayload, registry);
  });
  tagged[HOOK_INSTALLED] = true;
}
