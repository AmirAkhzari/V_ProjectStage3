import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_OPERATION_IDS,
  checkOpenApiV11Scope,
  parseOpenApiYaml,
  type OpenApiDoc,
} from '../../scripts/diff-openapi-v1-1.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../openapi');

function load(file: string): OpenApiDoc {
  return parseOpenApiYaml(readFileSync(join(dir, file), 'utf8')) as OpenApiDoc;
}

function op(doc: OpenApiDoc, path: string, method: string): Record<string, unknown> {
  const item = doc.paths?.[path];
  const operation = item?.[method];
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error(`missing ${method.toUpperCase()} ${path}`);
  }
  return operation as Record<string, unknown>;
}

describe('OpenAPI v1.0.0 → v1.1.0 scope', () => {
  const v10 = load('openapi-v1.0.0.yaml');
  const v11 = load('openapi-v1.1.0.yaml');

  it('accepts the frozen pair (only A1–A5, B1–B5, C1–C3 plus new schemas)', () => {
    expect(checkOpenApiV11Scope(v10, v11)).toEqual([]);
    expect(ALLOWED_OPERATION_IDS.size).toBe(13);
  });

  it('accepts a document compared with itself', () => {
    expect(checkOpenApiV11Scope(v10, v10)).toEqual([]);
  });

  it('fails if a disallowed operation changes', () => {
    const mutated = structuredClone(v11);
    op(mutated, '/v1/admin/drivers/{id}/unlock', 'post')['summary'] = 'changed';
    expect(checkOpenApiV11Scope(v10, mutated)).toEqual(
      expect.arrayContaining([expect.stringMatching(/B83 is outside A1–A5, B1–B5, C1–C3/)]),
    );
  });

  it('fails if an allowed operation changes security or x-permission', () => {
    const mutated = structuredClone(v11);
    op(mutated, '/v1/app/auth/otp/send', 'post')['x-permission'] = 'shopkeeper:self';
    expect(checkOpenApiV11Scope(v10, mutated)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/A1 changed outside requestBody \/ 200 content/),
      ]),
    );
  });

  it('fails if an existing schema changes', () => {
    const mutated = structuredClone(v11);
    const errorCode = mutated.components?.schemas?.['ErrorCode'] as { enum: string[] };
    errorCode.enum.push('NEW_CODE');
    expect(checkOpenApiV11Scope(v10, mutated)).toEqual(
      expect.arrayContaining([expect.stringMatching(/schema ErrorCode changed/)]),
    );
  });

  it('fails if a path is added', () => {
    const mutated = structuredClone(v11);
    const logout = mutated.paths?.['/v1/app/auth/logout'];
    if (!logout || !mutated.paths) throw new Error('missing logout path');
    mutated.paths['/v1/app/extra'] = structuredClone(logout);
    op(mutated, '/v1/app/extra', 'post')['operationId'] = 'A99';
    expect(checkOpenApiV11Scope(v10, mutated)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/path set changed/),
        expect.stringMatching(/operation A99 added/),
      ]),
    );
  });
});
