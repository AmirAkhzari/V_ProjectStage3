#!/usr/bin/env node
/**
 * CI gate: openapi-v1.0.0 → v1.1.0 may change only A1–A5, B1–B5, C1–C3
 * (requestBody + 200 schema) plus new component schemas. Everything else must
 * match, including path/method/security/x-permission/parameters/status codes.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ALLOWED_OPERATION_IDS = new Set([
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'C1',
  'C2',
  'C3',
]);

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const ALLOWED_INFO_KEYS = new Set(['version', 'description', 'x-freeze-status']);

/** O-4 verbatim contract-wide rules that must stay in info.description. */
export const REQUIRED_RULE_SNIPPETS = [
  '(R1, AppSec C-3) A resource outside the caller tenant or ownership returns 404 NOT_FOUND with a body byte-identical to a genuinely missing resource',
  '(R2, AppSec C-2) driver_inactive (403) is returned only to an already-authenticated driver request',
  '(R3, AppSec C-4) A33 cancel: optional Idempotency-Key',
] as const;

/**
 * Frozen 200 responses that $ref session schemas carrying accessToken / refreshToken.
 * A5/B5 are demo login (same session as A2/B2); C11 returns a new DriverSession.
 */
export const TOKEN_RESPONSE_OPERATION_IDS = new Set([
  'A2',
  'A3',
  'A5',
  'B2',
  'B3',
  'B5',
  'C1',
  'C2',
  'C11',
]);
const TOKEN_PROPERTY_NAMES = new Set(['accessToken', 'refreshToken']);

type JsonObject = Record<string, unknown>;

export interface OpenApiDoc {
  openapi?: string;
  info?: JsonObject;
  servers?: unknown;
  tags?: unknown;
  security?: unknown;
  externalDocs?: unknown;
  paths?: Record<string, JsonObject>;
  components?: JsonObject & { schemas?: Record<string, unknown> };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface ListedOp {
  path: string;
  method: string;
  id: string | undefined;
  op: JsonObject;
  item: JsonObject;
}

function listOperations(doc: OpenApiDoc): ListedOp[] {
  const ops: ListedOp[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!isObject(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !isObject(op)) continue;
      const id = op['operationId'];
      ops.push({
        path,
        method,
        id: typeof id === 'string' ? id : undefined,
        op,
        item,
      });
    }
  }
  return ops;
}

function pathItemMeta(item: JsonObject): JsonObject {
  const meta = { ...item };
  for (const method of HTTP_METHODS) delete meta[method];
  return meta;
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function checkNormativeRules(v11: OpenApiDoc): string[] {
  const description = collapseWs(String(v11.info?.['description'] ?? ''));
  return REQUIRED_RULE_SNIPPETS.filter((snippet) => !description.includes(snippet)).map(
    (snippet) => `info.description missing ${snippet.slice(0, 24).trim()}… (O-4)`,
  );
}

function isObjectSchema(schema: JsonObject): boolean {
  const type = schema['type'];
  if (type === 'object') return true;
  if (Array.isArray(type) && type.includes('object')) return true;
  return isObject(schema['properties']);
}

function objectSchemaIsClosed(schema: unknown): boolean {
  if (!isObject(schema)) return true;
  if (!isObjectSchema(schema)) return true;
  if (schema['additionalProperties'] !== false) return false;
  const properties = schema['properties'];
  if (!isObject(properties)) return true;
  return Object.values(properties).every((value) => objectSchemaIsClosed(value));
}

function checkNewSchemasClosed(schemas10: JsonObject, schemas11: JsonObject): string[] {
  const errors: string[] = [];
  for (const name of Object.keys(schemas11)) {
    if (name in schemas10) continue;
    if (!objectSchemaIsClosed(schemas11[name])) {
      errors.push(`new schema ${name} must set additionalProperties: false`);
    }
  }
  return errors;
}

function schemaRefName(schema: JsonObject): string | undefined {
  const ref = schema['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    return ref.slice('#/components/schemas/'.length);
  }
  return undefined;
}

function collectTokenProperties(schema: unknown, schemas: JsonObject, seen: Set<string>): string[] {
  if (!isObject(schema)) return [];
  const ref = schemaRefName(schema);
  if (ref) {
    if (seen.has(ref)) return [];
    seen.add(ref);
    return collectTokenProperties(schemas[ref], schemas, seen);
  }
  const found: string[] = [];
  const properties = schema['properties'];
  if (isObject(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      if (TOKEN_PROPERTY_NAMES.has(key)) found.push(key);
      found.push(...collectTokenProperties(value, schemas, seen));
    }
  }
  return found;
}

function operationJsonSchema(op: JsonObject): unknown {
  const responses = op['responses'];
  if (!isObject(responses)) return undefined;
  const ok = responses['200'];
  if (!isObject(ok)) return undefined;
  const content = ok['content'];
  if (!isObject(content)) return undefined;
  const json = content['application/json'];
  if (!isObject(json)) return undefined;
  return json['schema'];
}

function checkTokenPlacement(v11: OpenApiDoc, schemas11: JsonObject): string[] {
  const errors: string[] = [];
  for (const listed of listOperations(v11)) {
    if (!listed.id) continue;
    const tokens = [
      ...new Set(collectTokenProperties(operationJsonSchema(listed.op), schemas11, new Set())),
    ];
    if (tokens.length === 0) continue;
    if (!TOKEN_RESPONSE_OPERATION_IDS.has(listed.id)) {
      errors.push(
        `tokens (${tokens.join(', ')}) appear in ${listed.id} 200; only A2/A3/A5/B2/B3/B5/C1/C2/C11 200 may carry tokens`,
      );
    }
  }
  return errors;
}

function operationCore(op: JsonObject, stripAllowedBody: boolean): JsonObject {
  const next = clone(op);
  if (stripAllowedBody) {
    delete next['requestBody'];
    const responses = next['responses'];
    if (isObject(responses)) {
      const ok = responses['200'];
      if (isObject(ok)) delete ok['content'];
    }
  }
  return next;
}

export function checkOpenApiV11Scope(v10raw: unknown, v11raw: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(v10raw) || !isObject(v11raw)) {
    return ['both documents must be OpenAPI objects'];
  }
  const v10 = v10raw as OpenApiDoc;
  const v11 = v11raw as OpenApiDoc;

  if (v10.openapi !== v11.openapi) {
    errors.push(`openapi version changed: ${v10.openapi} → ${v11.openapi}`);
  }

  const info10 = { ...(v10.info ?? {}) };
  const info11 = { ...(v11.info ?? {}) };
  for (const key of ALLOWED_INFO_KEYS) {
    delete info10[key];
    delete info11[key];
  }
  if (!deepEqual(info10, info11)) {
    errors.push('info changed outside version/description/x-freeze-status');
  }

  for (const key of ['servers', 'tags', 'security', 'externalDocs'] as const) {
    if (!deepEqual(v10[key], v11[key])) errors.push(`top-level ${key} changed`);
  }

  const paths10 = Object.keys(v10.paths ?? {}).sort();
  const paths11 = Object.keys(v11.paths ?? {}).sort();
  if (!deepEqual(paths10, paths11)) {
    errors.push('path set changed');
  }

  const ops10 = listOperations(v10);
  const ops11 = listOperations(v11);
  const byId10 = new Map(ops10.map((op) => [op.id, op]));
  const byId11 = new Map(ops11.map((op) => [op.id, op]));

  if (ops10.some((op) => !op.id) || ops11.some((op) => !op.id)) {
    errors.push('every operation must have an operationId');
  }

  for (const id of byId10.keys()) {
    if (id && !byId11.has(id)) errors.push(`operation ${id} removed in v1.1.0`);
  }
  for (const id of byId11.keys()) {
    if (id && !byId10.has(id)) errors.push(`operation ${id} added in v1.1.0`);
  }

  const ids = [...new Set([...byId10.keys(), ...byId11.keys()])]
    .filter((id): id is string => Boolean(id))
    .sort();
  for (const id of ids) {
    const left = byId10.get(id);
    const right = byId11.get(id);
    if (!left || !right) continue;
    if (left.path !== right.path || left.method !== right.method) {
      errors.push(
        `operation ${id} moved: ${left.method.toUpperCase()} ${left.path} → ${right.method.toUpperCase()} ${right.path}`,
      );
    }
    if (!deepEqual(pathItemMeta(left.item), pathItemMeta(right.item))) {
      errors.push(`path item metadata changed on ${left.path} (${id})`);
    }

    const allowed = ALLOWED_OPERATION_IDS.has(id);
    if (!deepEqual(operationCore(left.op, allowed), operationCore(right.op, allowed))) {
      errors.push(
        allowed
          ? `operation ${id} changed outside requestBody / 200 content`
          : `operation ${id} is outside A1–A5, B1–B5, C1–C3`,
      );
    }

    if (allowed) {
      const responses10 = isObject(left.op['responses']) ? left.op['responses'] : {};
      const responses11 = isObject(right.op['responses']) ? right.op['responses'] : {};
      if (!deepEqual(Object.keys(responses10).sort(), Object.keys(responses11).sort())) {
        errors.push(`operation ${id} response status codes changed`);
      }
    }
  }

  const c10 = v10.components ?? {};
  const c11 = v11.components ?? {};
  const componentKeys = new Set([...Object.keys(c10), ...Object.keys(c11)]);
  for (const key of componentKeys) {
    if (key === 'schemas') continue;
    if (!deepEqual(c10[key], c11[key])) {
      errors.push(`components.${key} changed`);
    }
  }

  const schemas10 = isObject(c10['schemas']) ? c10['schemas'] : {};
  const schemas11 = isObject(c11['schemas']) ? c11['schemas'] : {};
  for (const name of Object.keys(schemas10)) {
    if (!(name in schemas11)) {
      errors.push(`schema ${name} removed in v1.1.0`);
      continue;
    }
    if (!deepEqual(schemas10[name], schemas11[name])) {
      errors.push(`schema ${name} changed (existing schemas must stay byte-equivalent)`);
    }
  }

  errors.push(...checkNormativeRules(v11));
  errors.push(...checkNewSchemasClosed(schemas10, schemas11));
  errors.push(...checkTokenPlacement(v11, schemas11));

  return errors;
}

export function parseOpenApiYaml(text: string): unknown {
  return parse(text, { maxAliasCount: -1 });
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const openapiDir = join(dirname(fileURLToPath(import.meta.url)), '../openapi');
  const v10 = parseOpenApiYaml(await readFile(join(openapiDir, 'openapi-v1.0.0.yaml'), 'utf8'));
  const v11 = parseOpenApiYaml(await readFile(join(openapiDir, 'openapi-v1.1.0.yaml'), 'utf8'));
  const errors = checkOpenApiV11Scope(v10, v11);
  if (errors.length > 0) {
    process.stderr.write(
      `OpenAPI v1.0.0 → v1.1.0 scope check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  const v10Doc = v10 as OpenApiDoc;
  const v11Doc = v11 as OpenApiDoc;
  const added = Object.keys(v11Doc.components?.schemas ?? {}).filter(
    (name) => !(name in (v10Doc.components?.schemas ?? {})),
  );
  process.stdout.write(
    `OpenAPI v1.0.0 → v1.1.0 scope ok (${ALLOWED_OPERATION_IDS.size} allowed operations, ${added.length} new schemas)\n`,
  );
}
