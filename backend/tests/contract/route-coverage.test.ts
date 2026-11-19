import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { parse } from 'yaml';
import { buildApp, type App } from '../../src/app.js';
import { ROUTE_REGISTRY } from '../../src/http/routeRegistry.js';
import { PENDING_OPERATION_IDS } from '../../src/http/pendingOperations.js';
import type { RouteRegistry, RouteRegistryRow } from '../../src/platform/http/routeRegistry.js';
import { INFRA_CATCH_ALL_PATHS, toOpenApiPath } from '../../src/platform/http/routeRegistry.js';
import { PUBLIC_ROUTES } from '../../src/platform/http/publicRoutes.js';
import { productionApiConfig } from '../helpers/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const yamlPath = join(root, 'openapi/openapi-v1.2.0.yaml');
const EXPECTED_SHA = 'e3dc40d5a8755d2639b77415f321bf9b7c852a7f6e4f3bb23c5102165e054601';
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

const LIVE = 'S1 S2 A1 A2 A3 A4 A7 B1 B2 B3 B4 B24 B33 C1 C2 C11 B25 B27 B83'.split(' ');
const DEMO = ['A5', 'B5'];
const UNREGISTERED_IN_PROD = ['A5', 'A35', 'B5', 'B79', 'B80'];

export interface SpecOperation {
  operationId: string;
  method: string;
  path: string;
  permission: string;
  environment?: string;
}

export interface CapturedRoute {
  method: string;
  url: string;
  prefix?: string;
  operationId?: string;
}

function specOperations(): SpecOperation[] {
  const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
    paths: Record<
      string,
      Record<string, { operationId?: string; 'x-permission'?: string; 'x-environment'?: string }>
    >;
  };
  const operations: SpecOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !op?.operationId) continue;
      operations.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        permission: op['x-permission'] ?? '',
        ...(op['x-environment'] ? { environment: op['x-environment'] } : {}),
      });
    }
  }
  return operations;
}

/** x-permission → registry access, ignoring the must-change flag (checked separately). */
function accessMatches(row: RouteRegistryRow, rawPermission: string): boolean {
  const access = row.access;
  // Strip contract annotations such as `(dev only)` / `(allowed while must_change_password)`.
  const permission = rawPermission.replace(/\s*\(.*$/, '');
  if (permission === 'public') return access.kind === 'public';
  if (permission === 'staff:authenticated')
    return access.kind === 'authenticated' && access.subject === 'staff';
  if (permission === 'shopkeeper:self')
    return access.kind === 'authenticated' && access.subject === 'shopkeeper';
  if (permission === 'driver:self')
    return access.kind === 'authenticated' && access.subject === 'driver';
  if (permission === 'staff:super_admin')
    return access.kind === 'role' && access.role === 'super_admin';
  if (access.kind !== 'permission') return false;
  const codes = permission.split(/\s*\/\s*/).sort();
  const actual = (codes.length > 1 ? access.anyOf : access.allOf) ?? [];
  return (
    [...actual].sort().join('|') === codes.join('|') &&
    (codes.length > 1 ? access.allOf === undefined : access.anyOf === undefined)
  );
}

/**
 * Contract coverage checker. Given the frozen spec, the registry and a captured router table,
 * fails with the operationId for any mismatch. Pure, so the self-tests can feed bad captures.
 */
export function checkContractCoverage(input: {
  spec: readonly SpecOperation[];
  registry: RouteRegistry;
  captured: readonly CapturedRoute[];
  expectedOperationIds: readonly string[];
  publicRoutes: readonly { operationId: string; method: string; path: string }[];
}): void {
  const { spec, registry, captured, expectedOperationIds, publicRoutes } = input;
  const specById = new Map(spec.map((op) => [op.operationId, op]));

  // 1. Spec ↔ registry bijection.
  for (const op of spec) {
    const row = registry.byOperationId.get(op.operationId);
    if (!row) throw new Error(`coverage: ${op.operationId} has no registry row`);
    if (row.method !== op.method || row.path !== op.path) {
      throw new Error(
        `coverage: ${op.operationId} registry is ${row.method} ${row.path}, spec is ${op.method} ${op.path}`,
      );
    }
  }
  for (const row of registry.rows) {
    if (!specById.has(row.operationId))
      throw new Error(`coverage: registry row ${row.operationId} is not in the spec`);
    if (row.access.kind === undefined)
      throw new Error(`coverage: ${row.operationId} has no access rule`);
    // 2. Access mirrors x-permission.
    if (!accessMatches(row, specById.get(row.operationId)!.permission)) {
      throw new Error(
        `coverage: ${row.operationId} access does not mirror x-permission ${specById.get(row.operationId)!.permission}`,
      );
    }
  }

  // 3. Public rows equal the explicit allowlist.
  const registryPublic = registry.rows
    .filter((row) => row.access.kind === 'public')
    .map((row) => ({ operationId: row.operationId, method: row.method, path: row.path }))
    .sort((a, b) => a.operationId.localeCompare(b.operationId));
  const expectedPublic = [...publicRoutes].sort((a, b) =>
    a.operationId.localeCompare(b.operationId),
  );
  if (JSON.stringify(registryPublic) !== JSON.stringify(expectedPublic)) {
    throw new Error('coverage: registry public rows differ from the explicit PUBLIC_ROUTES list');
  }

  // 4. Captured router table ↔ spec / expected mounted set.
  const capturedIds = new Set<string>();
  for (const route of captured) {
    const url = toOpenApiPath(route.url);
    const prefixed =
      route.prefix && !url.startsWith(route.prefix) ? toOpenApiPath(`${route.prefix}${url}`) : url;
    if (route.operationId === undefined) {
      if (INFRA_CATCH_ALL_PATHS.has(prefixed)) continue;
      throw new Error(`coverage: captured ${route.method} ${prefixed} has no operationId`);
    }
    capturedIds.add(route.operationId);
    const op = specById.get(route.operationId);
    if (!op) throw new Error(`coverage: captured ${route.operationId} is not in the spec`);
    if (route.method === 'HEAD' && op.method === 'GET') continue;
    if (route.method !== op.method || prefixed !== op.path) {
      throw new Error(
        `coverage: captured ${route.method} ${prefixed} does not match ${route.operationId} ${op.method} ${op.path}`,
      );
    }
  }
  const expected = new Set(expectedOperationIds);
  for (const operationId of expected) {
    if (!capturedIds.has(operationId)) {
      throw new Error(`coverage: expected live route ${operationId} was not captured`);
    }
  }
  for (const operationId of capturedIds) {
    if (!expected.has(operationId)) {
      throw new Error(`coverage: captured ${operationId} should not be mounted`);
    }
  }
}

async function captureRoutes(config: ReturnType<typeof productionApiConfig>): Promise<{
  app: App;
  captured: CapturedRoute[];
}> {
  const captured: CapturedRoute[] = [];
  // `onRoute` is a test-only option refused under NODE_ENV=production, so capture in test.
  // The production-shaped staging/live boot cases below use real NODE_ENV=production.
  const app = await buildApp({
    config: { ...config, NODE_ENV: 'test' },
    healthChecks: [],
    appDb: {} as pg.Pool,
    onRoute: (route) => {
      captured.push({
        method: (Array.isArray(route.method) ? route.method[0] : route.method) ?? '',
        url: route.url,
        ...(route.prefix ? { prefix: route.prefix } : {}),
        ...(typeof route.schema?.operationId === 'string'
          ? { operationId: route.schema.operationId }
          : {}),
      });
    },
  });
  await app.ready();
  return { app, captured };
}

const spec = specOperations();

/** P4-1: derived at test time from the frozen spec, never a hard-coded source of truth. */
const PROD_ABSENT_OPERATION_IDS = spec
  .filter((op) => op.environment?.includes('non-production') === true)
  .map((op) => op.operationId)
  .sort();

describe('frozen contract coverage (slice 1b)', () => {
  it('keeps the frozen v1.2.0 sha256', () => {
    const sha = createHash('sha256').update(readFileSync(yamlPath)).digest('hex');
    expect(sha).toBe(EXPECTED_SHA);
  });

  it('spec has 139 operations and the registry maps every one', () => {
    expect(spec).toHaveLength(139);
    expect(ROUTE_REGISTRY.rows).toHaveLength(139);
    expect(ROUTE_REGISTRY.byOperationId.size).toBe(139);
  });

  it('PENDING ids are counted, mapped, and not live', () => {
    expect(PENDING_OPERATION_IDS).toHaveLength(115);
    expect(new Set(PENDING_OPERATION_IDS).size).toBe(115);
    const pending = new Set(PENDING_OPERATION_IDS);
    for (const operationId of PENDING_OPERATION_IDS) {
      expect(ROUTE_REGISTRY.byOperationId.has(operationId)).toBe(true);
    }
    for (const operationId of [...LIVE, ...DEMO]) expect(pending.has(operationId)).toBe(false);
    for (const operationId of UNREGISTERED_IN_PROD) expect(pending.has(operationId)).toBe(false);
  });

  it('P4-1: derives the prod-absent set from the frozen spec x-environment', async () => {
    expect(PROD_ABSENT_OPERATION_IDS.length).toBeGreaterThan(0);
    expect(PROD_ABSENT_OPERATION_IDS).toEqual(['A35', 'A5', 'B5', 'B79', 'B80'].sort());
    const { app } = await captureRoutes(productionApiConfig());
    try {
      for (const operationId of PROD_ABSENT_OPERATION_IDS) {
        const row = ROUTE_REGISTRY.byOperationId.get(operationId)!;
        expect(app.hasRoute({ method: row.method, url: row.path })).toBe(false);
      }
    } finally {
      await app.close();
    }
  });

  it('proD-like boot matches the spec except the explicit exceptions', async () => {
    const { app, captured } = await captureRoutes(productionApiConfig());
    try {
      checkContractCoverage({
        spec,
        registry: ROUTE_REGISTRY,
        captured,
        expectedOperationIds: LIVE,
        publicRoutes: PUBLIC_ROUTES,
      });
      for (const operationId of [...PENDING_OPERATION_IDS, ...UNREGISTERED_IN_PROD]) {
        const row = ROUTE_REGISTRY.byOperationId.get(operationId)!;
        expect(app.hasRoute({ method: row.method, url: row.path })).toBe(false);
      }
      expect(captured.some((route) => route.operationId === 'A5')).toBe(false);
      expect(captured.some((route) => route.operationId === 'B5')).toBe(false);
    } finally {
      await app.close();
    }
  });

  /** P6-9/P6-10: real NODE_ENV=production boots mount exactly the expected ids. */
  async function expectMounted(c: ReturnType<typeof productionApiConfig>, ids: readonly string[]) {
    const app = await buildApp({ config: c, healthChecks: [], appDb: {} as pg.Pool });
    await app.ready();
    try {
      const want = new Set(ids);
      for (const row of ROUTE_REGISTRY.rows) {
        const url = row.path.replace(/\{([^}]+)\}/g, ':$1');
        const mounted = app.hasRoute({ method: row.method, url });
        expect(mounted, row.operationId).toBe(want.has(row.operationId));
      }
    } finally {
      await app.close();
    }
  }

  it('real production boot mounts exactly LIVE; staging adds only A5/B5', async () => {
    await expectMounted(productionApiConfig(), LIVE);
    // `demoLoginEnabled` is `(nodeEnv !== 'production' || deployEnv === 'staging') && flag`.
    const config = productionApiConfig({
      DEPLOY_ENV: 'staging',
      DEMO_LOGIN_ENABLED: 'true',
      DEMO_JWT_EDDSA_KID: 'k-staging',
      DEMO_JWT_EDDSA_JWKS: '{"keys":[]}',
      RATE_DEMO_PER_IP_HOUR: '10',
      RATE_DEMO_GLOBAL_DAY: '100',
    });
    await expectMounted(config, [...LIVE, ...DEMO]);
  });

  it('self-test: the checker rejects a missing mapping and an extra route', () => {
    const base: CapturedRoute[] = LIVE.map((operationId) => {
      const row = ROUTE_REGISTRY.byOperationId.get(operationId)!;
      return { method: row.method, url: row.path, operationId };
    });
    expect(() =>
      checkContractCoverage({
        spec,
        registry: ROUTE_REGISTRY,
        captured: base,
        expectedOperationIds: LIVE,
        publicRoutes: PUBLIC_ROUTES,
      }),
    ).not.toThrow();
    expect(() =>
      checkContractCoverage({
        spec,
        registry: ROUTE_REGISTRY,
        captured: base.filter((route) => route.operationId !== 'B25'),
        expectedOperationIds: LIVE,
        publicRoutes: PUBLIC_ROUTES,
      }),
    ).toThrow(/B25/);
    expect(() =>
      checkContractCoverage({
        spec,
        registry: ROUTE_REGISTRY,
        captured: [...base, { method: 'GET', url: '/v1/admin/extra', operationId: 'ZZ' }],
        expectedOperationIds: LIVE,
        publicRoutes: PUBLIC_ROUTES,
      }),
    ).toThrow(/ZZ/);
  });
});
