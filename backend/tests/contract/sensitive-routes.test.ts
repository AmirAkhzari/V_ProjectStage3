import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SENSITIVE_OPERATION_IDS } from '../../src/platform/auth/sensitiveRoutes.js';

const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../../openapi/openapi-v1.2.0.yaml');
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const ALWAYS_SENSITIVE = new Set(['C11', 'C3', 'B4', 'B83']);
const PUBLIC_PAYMENT = new Set(['S3']);

describe('SENSITIVE_OPERATION_IDS vs frozen contract', () => {
  it('R11-5: registry matches C11/B83/logout-all and payment ops except S3', () => {
    const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
      paths: Record<
        string,
        Record<string, { operationId?: string; tags?: string[]; 'x-permission'?: string }>
      >;
    };
    const fromContract = new Set<string>();
    for (const item of Object.values(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method.toLowerCase()) || !op?.operationId) continue;
        const tags = op.tags ?? [];
        if (ALWAYS_SENSITIVE.has(op.operationId)) fromContract.add(op.operationId);
        if (tags.includes('payment') && !PUBLIC_PAYMENT.has(op.operationId)) {
          fromContract.add(op.operationId);
        }
      }
    }
    expect([...fromContract].sort()).toEqual([...SENSITIVE_OPERATION_IDS].sort());
  });
});
