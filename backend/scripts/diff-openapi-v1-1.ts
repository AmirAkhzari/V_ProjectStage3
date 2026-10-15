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
