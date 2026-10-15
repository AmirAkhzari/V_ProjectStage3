import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_REFRESH,
  EXPECTED_TOKEN_SITES,
  PINNED_V1_1_0,
  checkOpenApiV12Scope,
  checkV11Pin,
  parseOpenApiYaml,
  sha256Bytes,
  type JsonObject,
  type OpenApiDoc,
} from '../../scripts/diff-openapi-v1-2.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../openapi');

function load(file: string): OpenApiDoc {
  return parseOpenApiYaml(readFileSync(join(dir, file), 'utf8')) as OpenApiDoc;
}

function schemas(doc: OpenApiDoc): Record<string, JsonObject> {
  const raw = doc.components?.['schemas'];
  if (!raw || typeof raw !== 'object') throw new Error('missing schemas');
  return raw as Record<string, JsonObject>;
}

function post(doc: OpenApiDoc, path: string): JsonObject {
  const item = doc.paths?.[path];
  const operation = item?.['post'];
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error(`missing POST ${path}`);
  }
  return operation as JsonObject;
}

const RT = { type: 'string', minLength: 43 };
const A3 = '/v1/app/auth/refresh';

type Mutator = (doc: OpenApiDoc) => void;

const MUTATIONS: Array<{ name: string; mutate: Mutator; want?: string }> = [
  {
    name: 'm_login_opt',
    mutate: (doc) => {
      const required = schemas(doc)['ShopkeeperSession']?.['required'];
      if (Array.isArray(required)) {
        const index = required.indexOf('refreshToken');
        if (index >= 0) required.splice(index, 1);
      }
    },
  },
  {
    name: 'm_login_repoint',
    mutate: (doc) => {
      const responses = post(doc, '/v1/app/auth/otp/verify')['responses'] as JsonObject;
      const ok = (responses['200'] as JsonObject)['content'] as JsonObject;
      ((ok['application/json'] as JsonObject)['schema'] as JsonObject)['$ref'] =
        '#/components/schemas/ShopkeeperRefreshSession';
    },
  },
  {
    name: 'm_abs_opt',
    mutate: (doc) => {
      const required = schemas(doc)['StaffRefreshSession']?.['required'];
      if (Array.isArray(required)) {
        const index = required.indexOf('absoluteExpiresAt');
        if (index >= 0) required.splice(index, 1);
      }
    },
  },
  {
    name: 'm_open',
    mutate: (doc) => {
      schemas(doc)['DriverRefreshSession']!['additionalProperties'] = true;
    },
  },
  {
    name: 'm_echo',
    mutate: (doc) => {
      const props = schemas(doc)['ShopkeeperRefreshSession']!['properties'] as JsonObject;
      props['presentedRefreshToken'] = { type: 'string' };
    },
  },
  {
    name: 'm_no_rule',
    mutate: (doc) => {
      schemas(doc)['StaffRefreshSession']!['description'] = 'refresh session';
    },
  },
  {
    name: 'm_no_pair',
    mutate: (doc) => {
      delete schemas(doc)['DriverRefreshSession']!['dependentRequired'];
    },
  },
  {
    name: 'm_other_req',
    mutate: (doc) => {
      const required = schemas(doc)['DriverRefreshSession']?.['required'];
      if (Array.isArray(required)) {
        const index = required.indexOf('mustChangePassword');
        if (index >= 0) required.splice(index, 1);
      }
    },
  },
  {
    name: 'm_r1',
    mutate: (doc) => {
      if (!doc.info) throw new Error('missing info');
      doc.info['description'] = String(doc.info['description']).replace('never 403', 'may 403');
    },
  },
  {
    name: 'm_r2',
    mutate: (doc) => {
      if (!doc.info) throw new Error('missing info');
      doc.info['description'] = String(doc.info['description']).replace('(R2, AppSec C-2)', '(R2)');
    },
  },
  {
    name: 'm_r3',
    mutate: (doc) => {
      if (!doc.info) throw new Error('missing info');
      doc.info['description'] = String(doc.info['description']).replace(
        'idempotent by state',
        'not idempotent',
      );
    },
  },
  {
    name: 'm_other_op',
    mutate: (doc) => {
      post(doc, '/v1/app/auth/logout')['summary'] = 'x';
    },
  },
  {
    name: 'm_a3_desc',
    mutate: (doc) => {
      const responses = post(doc, A3)['responses'] as JsonObject;
      (responses['200'] as JsonObject)['description'] = 'x';
    },
  },
  {
    name: 'm_a3_401',
    mutate: (doc) => {
      const responses = post(doc, A3)['responses'] as JsonObject;
      if ('401' in responses) delete responses['401'];
      else responses['499'] = { description: 'x' };
    },
  },
  {
    name: 'm_token_place',
    mutate: (doc) => {
      const props = schemas(doc)['LogoutResponse']!['properties'] as JsonObject;
      props['refreshToken'] = { type: 'string' };
    },
  },
  {
    name: 'm_rt_req',
    mutate: (doc) => {
      schemas(doc)['EmptyRequest']!['properties'] = { refreshToken: { type: 'string' } };
    },
  },
  {
    name: 'm_extra_schema',
    mutate: (doc) => {
      schemas(doc)['Extra'] = { type: 'object', additionalProperties: false };
    },
  },
  {
    name: 'm_leak',
    mutate: (doc) => {
      const responses = post(doc, '/v1/app/auth/demo')['responses'] as JsonObject;
      const ok = (responses['200'] as JsonObject)['content'] as JsonObject;
      (ok['application/json'] as JsonObject)['schema'] = {
        $ref: '#/components/schemas/ShopkeeperRefreshSession',
      };
    },
  },
  {
    name: 'm_version',
    mutate: (doc) => {
      if (!doc.info) throw new Error('missing info');
      doc.info['version'] = '1.1.1';
    },
  },
  {
    name: 'm_status',
    mutate: (doc) => {
      if (!doc.info) throw new Error('missing info');
      doc.info['x-freeze-status'] = 'draft';
    },
  },
  {
    name: 'm_rt_maxlen',
    mutate: (doc) => {
      const props = schemas(doc)['StaffRefreshSession']!['properties'] as JsonObject;
      (props['refreshToken'] as JsonObject)['maxLength'] = 9999;
    },
  },
  {
    name: 'm_nested_open',
    mutate: (doc) => {
      const props = schemas(doc)['DriverRefreshSession']!['properties'] as JsonObject;
      props['driver'] = { type: 'object' };
    },
  },
  {
    name: 't_rt_in_4xx',
    want: 'token placement',
    mutate: (doc) => {
      const responses = post(doc, A3)['responses'] as JsonObject;
      responses['4XX'] = {
        description: 'x',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { refreshToken: RT },
            },
          },
        },
      };
    },
  },
  {
    name: 't_rt_in_5xx_component',
    want: 'token placement',
    mutate: (doc) => {
      const responses = doc.components?.['responses'] as Record<string, JsonObject>;
      const error = responses['Error']!;
      const content = error['content'] as JsonObject;
      (content['application/json'] as JsonObject)['schema'] = {
        type: 'object',
        properties: { error: {}, refreshToken: RT },
      };
    },
  },
  {
    name: 't_rt_header',
    want: 'token placement',
    mutate: (doc) => {
      const responses = post(doc, A3)['responses'] as JsonObject;
      const ok = responses['200'] as JsonObject;
      ok['headers'] = { refreshToken: { schema: RT } };
    },
  },
  {
    name: 't_rt_query',
    want: 'token placement',
    mutate: (doc) => {
      post(doc, A3)['parameters'] = [{ name: 'refreshToken', in: 'query', schema: RT }];
    },
  },
  {
    name: 't_at_in_b4_200',
    want: 'token placement',
    mutate: (doc) => {
      const responses = post(doc, '/v1/admin/auth/logout')['responses'] as JsonObject;
      const ok = (responses['200'] as JsonObject)['content'] as JsonObject;
      (ok['application/json'] as JsonObject)['schema'] = {
        type: 'object',
        additionalProperties: false,
        properties: { accessToken: RT },
      };
    },
  },
  {
    name: 't_rt_dropped_from_a2',
    want: 'token placement',
    mutate: (doc) => {
      const responses = post(doc, '/v1/app/auth/otp/verify')['responses'] as JsonObject;
      const ok = (responses['200'] as JsonObject)['content'] as JsonObject;
      (ok['application/json'] as JsonObject)['schema'] = {
        $ref: '#/components/schemas/LogoutResponse',
      };
    },
  },
  {
    name: 't_rt_header_component',
    want: 'token placement',
    mutate: (doc) => {
      const headers = (doc.components ?? {}) as JsonObject;
      (headers['headers'] as JsonObject)['refreshToken'] = { schema: RT };
      const responses = post(doc, '/v1/app/auth/otp/verify')['responses'] as JsonObject;
      (responses['200'] as JsonObject)['headers'] = {
        'x-rt': { $ref: '#/components/headers/refreshToken' },
      };
    },
  },
  {
    name: 't_bearer_removed',
    want: 'bearer',
    mutate: (doc) => {
      post(doc, '/v1/admin/auth/logout')['security'] = [];
    },
  },
  {
    name: 't_bearer_swapped',
    want: 'bearer',
    mutate: (doc) => {
      post(doc, '/v1/admin/auth/logout')['security'] = [{ driverBearer: [] }];
    },
  },
  {
    name: 't_set_cookie',
    want: 'cookie',
    mutate: (doc) => {
      const responses = post(doc, A3)['responses'] as JsonObject;
      (responses['200'] as JsonObject)['headers'] = {
        'Set-Cookie': { schema: { type: 'string' } },
      };
    },
  },
];

describe('OpenAPI v1.1.0 → v1.2.0 scope', () => {
  const v11 = load('openapi-v1.1.0.yaml');
  const v12 = load('openapi-v1.2.0.yaml');

  it('accepts the frozen pair (A3/B3/C2 refresh schemas only, 22 token sites)', () => {
    expect(checkOpenApiV12Scope(v11, v12)).toEqual([]);
    expect(Object.keys(ALLOWED_REFRESH)).toHaveLength(3);
    expect(EXPECTED_TOKEN_SITES).toBe(22);
  });

  it.each(MUTATIONS)('rejects $name', ({ mutate, want }) => {
    const mutated = structuredClone(v12);
    mutate(mutated);
    const errors = checkOpenApiV12Scope(v11, mutated);
    expect(errors.length).toBeGreaterThan(0);
    if (want) {
      expect(errors.some((error) => error.toLowerCase().includes(want))).toBe(true);
    }
  });

  it('rejects tampered v1.1.0 bytes (m_v11_bytes)', () => {
    const original = readFileSync(join(dir, 'openapi-v1.1.0.yaml'));
    expect(checkV11Pin(original)).toEqual([]);
    expect(sha256Bytes(original)).toBe(PINNED_V1_1_0);
    const tampered = Buffer.concat([original, Buffer.from('\n')]);
    expect(checkV11Pin(tampered)).toEqual(
      expect.arrayContaining([expect.stringMatching(/v1\.1\.0 sha .* != pinned/)]),
    );
  });
});
