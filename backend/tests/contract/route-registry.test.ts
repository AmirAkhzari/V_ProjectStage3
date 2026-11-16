import { describe, expect, it } from 'vitest';
import { ROUTE_REGISTRY } from '../../src/http/routeRegistry.js';
import { PUBLIC_OPERATION_IDS, PUBLIC_ROUTES } from '../../src/platform/http/publicRoutes.js';

type PublicShape = { operationId: string; method: string; path: string };

const sortById = (rows: readonly PublicShape[]): PublicShape[] =>
  [...rows].sort((a, b) => a.operationId.localeCompare(b.operationId));

describe('route registry vs PUBLIC_ROUTES', () => {
  it('PUB-ROUTES-01: public registry rows equal the explicit 14-row allowlist', () => {
    const publicRows: PublicShape[] = ROUTE_REGISTRY.rows
      .filter((row) => row.access.kind === 'public')
      .map((row) => ({ operationId: row.operationId, method: row.method, path: row.path }));
    expect(sortById(publicRows)).toEqual(sortById(PUBLIC_ROUTES));
    expect(publicRows).toHaveLength(14);
    expect(sortById(publicRows).map((row) => row.operationId)).toEqual(
      [...PUBLIC_OPERATION_IDS].sort(),
    );
  });

  it('every registry row has an access rule and a unique id', () => {
    const ids = new Set<string>();
    for (const row of ROUTE_REGISTRY.rows) {
      expect(row.access.kind).toMatch(/^(public|authenticated|permission|role)$/);
      expect(ids.has(row.operationId)).toBe(false);
      ids.add(row.operationId);
    }
    expect(ROUTE_REGISTRY.byOperationId.size).toBe(ROUTE_REGISTRY.rows.length);
  });

  it('slice 1b maps all 139 frozen v1.2.0 operations', () => {
    expect(ROUTE_REGISTRY.byOperationId.size).toBe(139);
    for (const operationId of ['S1', 'S2', 'S3', 'A5', 'B5', 'C11', 'B79', 'B80']) {
      expect(ROUTE_REGISTRY.byOperationId.has(operationId)).toBe(true);
    }
  });
});
