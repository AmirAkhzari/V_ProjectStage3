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
  /** Precomputed public `METHOD path` keys (L-3-4 lookup, no per-request scan). */
  readonly publicRoutes: ReadonlySet<string>;
}

/** P4-2 / L-4-1: module-private catch-all marker. Never exported; helpers only. */
const CATCH_ALL: unique symbol = Symbol('vproject.catchAll');

/** The only routes allowed to register without an operationId (three group catch-alls). */
export const INFRA_CATCH_ALL_PATHS: ReadonlySet<string> = new Set([
  '/v1/app/*',
  '/v1/admin/*',
  '/v1/driver/*',
]);

/** Config for a group catch-all registration; pair with `isCatchAllRoute`. */
export function catchAllRouteConfig(): { config: Record<symbol, true> } {
  return { config: { [CATCH_ALL]: true } };
}

/**
 * P4-2 / L-4-1: an operationId-less route is skipped only when BOTH the private marker is set
 * AND its normalised path is one of the three infra catch-alls. Anything else fails closed.
 */
export function isCatchAllRoute(
  config: Record<string | symbol, unknown> | undefined,
  url: string,
): boolean {
  return config?.[CATCH_ALL] === true && INFRA_CATCH_ALL_PATHS.has(toOpenApiPath(url));
}

/** P3-6a: Amir approved B4 as the single second must-change exception (DECISION_LOG §I). */
export const MUST_CHANGE_PASSWORD_OPS = ['C11', 'B4'] as const;

/** Subject bound to each API surface (L-3-3 / P3-3). */
const GROUP_SUBJECTS: Readonly<Record<string, RouteSubject>> = {
  '/v1/app': 'shopkeeper',
  '/v1/admin': 'staff',
  '/v1/driver': 'driver',
};

/** Only system routes may sit outside a group (P3-2b). S3 is the public callback. */
export const UNGROUPED_OPERATION_IDS: ReadonlySet<string> = new Set(['S1', 'S2', 'S3']);

function pathGroup(path: string): string | undefined {
  return Object.keys(GROUP_SUBJECTS).find(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

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
  const publicRoutes = new Set<string>();
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
    const group = pathGroup(row.path);
    if (row.access.kind === 'authenticated') {
      // L-3-3: an authenticated subject must match the path group, and system routes have none.
      if (group === undefined) {
        throw new Error(
          `route registry: ${row.operationId} is authenticated but has no API group path`,
        );
      }
      if (row.access.subject !== GROUP_SUBJECTS[group]) {
        throw new Error(
          `route registry: ${row.operationId} subject ${row.access.subject} does not match ${group}`,
        );
      }
    } else if (
      row.access.kind !== 'public' &&
      group === undefined &&
      !UNGROUPED_OPERATION_IDS.has(row.operationId)
    ) {
      throw new Error(
        `route registry: ${row.operationId} is not public and must live under an API group`,
      );
    }
    if (
      row.access.kind === 'authenticated' &&
      row.access.allowMustChangePassword === true &&
      !(MUST_CHANGE_PASSWORD_OPS as readonly string[]).includes(row.operationId)
    ) {
      throw new Error(
        `route registry: ${row.operationId} may not allow must-change-password access`,
      );
    }
    byOperationId.set(row.operationId, row);
    byRoute.add(routeKey);
    if (row.access.kind === 'public') publicRoutes.add(routeKey);
  }
  return { rows: [...rows], byOperationId, publicRoutes };
}

/** Structural subset of Fastify's onRoute payload that this check needs. */
export interface OnRoutePayload {
  method: string | string[];
  url: string;
  prefix?: string | undefined;
  config?: Record<string | symbol, unknown> | undefined;
  schema?: { operationId?: unknown } | undefined;
}

/** Prefix the route hook omitted from `url` (Fastify varies by encapsulation). */
function fullRoutePath(payload: OnRoutePayload): string {
  const url = toOpenApiPath(payload.url);
  const prefix = payload.prefix ?? '';
  return prefix !== '' && !url.startsWith(prefix) ? toOpenApiPath(`${prefix}${url}`) : url;
}

/** L-3-4: the public skip reads the registry row, not a module flag. */
export function isPublicRegistryRoute(
  registry: RouteRegistry,
  method: string,
  path: string,
): boolean {
  return registry.publicRoutes.has(`${method} ${toOpenApiPath(path)}`);
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
  const path = fullRoutePath(payload);
  const rawOperationId = payload.schema?.operationId;
  const operationId = typeof rawOperationId === 'string' ? rawOperationId : undefined;

  if (operationId === undefined || operationId.length === 0) {
    // P3-2c / P4-2: marker AND exact infra path are both required.
    if (isCatchAllRoute(payload.config, path)) return;
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
  // P3-2b: a non-public row must actually register under its group prefix.
  if (row.access.kind !== 'public' && !UNGROUPED_OPERATION_IDS.has(operationId)) {
    const group = pathGroup(row.path);
    if (group === undefined || !path.startsWith(`${group}/`)) {
      throw new Error(
        `route registry: ${operationId} is non-public and must register under an API group prefix`,
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
