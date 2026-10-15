import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PUBLIC_OPERATION_IDS, PUBLIC_ROUTES } from '../../src/platform/http/publicRoutes.js';

const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../../openapi/openapi-v1.0.0.yaml');
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

describe('PUBLIC_ROUTES vs frozen x-permission: public', () => {
  it('PUB-ROUTES-01: matches the contract public operations exactly', () => {
    const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
      paths: Record<string, Record<string, { operationId?: string; 'x-permission'?: string }>>;
    };
    const fromContract: { operationId: string; method: string; path: string }[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method.toLowerCase()) || !op) continue;
        if (op['x-permission'] === 'public' && op.operationId) {
          fromContract.push({
            operationId: op.operationId,
            method: method.toUpperCase(),
            path,
          });
        }
      }
    }
    const sortKey = (a: { operationId: string }) => a.operationId;
    expect(fromContract.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
      [...PUBLIC_ROUTES]
        .map((r) => ({ operationId: r.operationId, method: r.method, path: r.path }))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    );
    expect([...fromContract.map((r) => r.operationId)].sort()).toEqual(
      [...PUBLIC_OPERATION_IDS].sort(),
    );
    expect(PUBLIC_ROUTES).toHaveLength(14);
  });
});
