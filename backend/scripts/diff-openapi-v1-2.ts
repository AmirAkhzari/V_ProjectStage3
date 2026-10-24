#!/usr/bin/env node
/**
 * CI gate: openapi-v1.1.0 → v1.2.0 may change only the A3/B3/C2 refresh 200
 * response schemas (port of contract/tools/diff_v1_2.py, including F-1).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const PINNED_V1_1_0 = 'a62e4465f24e3dd18e9200472966d130f40bad196e21c8bee024d8948cdbd0b1';
export const PINNED_V1_2_0 = 'e3dc40d5a8755d2639b77415f321bf9b7c852a7f6e4f3bb23c5102165e054601';
export const EXPECTED_TOKEN_SITES = 22;

export const ALLOWED_REFRESH: Record<string, string> = {
  A3: 'ShopkeeperRefreshSession',
  B3: 'StaffRefreshSession',
  C2: 'DriverRefreshSession',
};
export const REFRESH_BASE: Record<string, string> = {
  ShopkeeperRefreshSession: 'ShopkeeperSession',
  StaffRefreshSession: 'StaffSession',
  DriverRefreshSession: 'DriverAuthSession',
};
const LOGIN: Record<string, string> = {
  A2: 'ShopkeeperSession',
  B2: 'StaffSession',
  C1: 'DriverAuthSession',
};
const TOKEN_RESP = new Set(['A2', 'A3', 'B2', 'B3', 'C1', 'C2', 'C11']);
const TOKEN_RESP_DEMO = new Set(['A5', 'B5']);
const RT_REQ = new Set(['A3', 'A4', 'B3', 'C2']);
const OPT = ['refreshToken', 'refreshExpiresAt'] as const;
const TOKEN_FIELDS = ['accessToken', 'refreshToken'] as const;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const DEPENDENT_REQUIRED = {
  refreshToken: ['refreshExpiresAt'],
  refreshExpiresAt: ['refreshToken'],
};

export type JsonObject = Record<string, unknown>;
export interface OpenApiDoc {
  openapi?: string;
  info?: JsonObject;
  servers?: unknown;
  tags?: unknown;
  security?: unknown;
  externalDocs?: unknown;
  paths?: Record<string, JsonObject>;
  components?: JsonObject & { schemas?: Record<string, JsonObject> };
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

export function parseOpenApiYaml(text: string): unknown {
  return parse(text, { maxAliasCount: -1 });
}

export function sha256Bytes(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function collectSchemaRefs(node: unknown, out: Set<string>): Set<string> {
  if (isObject(node)) {
    const ref = node['$ref'];
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      out.add(ref.slice('#/components/schemas/'.length));
    }
    for (const value of Object.values(node)) collectSchemaRefs(value, out);
  } else if (Array.isArray(node)) {
    for (const value of node) collectSchemaRefs(value, out);
  }
  return out;
}

function closure(names: Iterable<string>, schemas: Record<string, JsonObject>): Set<string> {
  const seen = new Set<string>();
  const todo = [...names];
  while (todo.length > 0) {
    const name = todo.pop();
    if (!name || seen.has(name) || !(name in schemas)) continue;
    seen.add(name);
    todo.push(...collectSchemaRefs(schemas[name], new Set()));
  }
  return seen;
}

function resolveSchema(node: unknown, schemas: Record<string, JsonObject>): JsonObject {
  let current = node;
  while (isObject(current) && typeof current['$ref'] === 'string') {
    const name = String(current['$ref']).split('/').at(-1) ?? '';
    current = schemas[name] ?? {};
  }
  return isObject(current) ? current : {};
}

function schema200(op: JsonObject): unknown {
  const responses = isObject(op['responses']) ? op['responses'] : {};
  const ok = isObject(responses['200']) ? responses['200'] : {};
  const content = isObject(ok['content']) ? ok['content'] : {};
  const json = isObject(content['application/json']) ? content['application/json'] : {};
  return json['schema'];
}

function checkClosed(node: unknown, path: string, errors: string[]): void {
  if (isObject(node)) {
    const type = node['type'];
    if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
      if (node['additionalProperties'] !== false) errors.push(`schema ${path} not closed`);
    }
    for (const [key, value] of Object.entries(node)) checkClosed(value, `${path}.${key}`, errors);
  } else if (Array.isArray(node)) {
    node.forEach((value, index) => {
      checkClosed(value, `${path}[${index}]`, errors);
    });
  }
}

function followRef(ref: string, doc: OpenApiDoc): unknown {
  if (!ref.startsWith('#/')) return {};
  let target: unknown = doc;
  for (const part of ref.slice(2).split('/')) {
    target = isObject(target) ? target[part] : {};
  }
  return target;
}

function deref(node: unknown, doc: OpenApiDoc): unknown {
  let current = node;
  for (let i = 0; i < 10; i += 1) {
    if (
      !isObject(current) ||
      typeof current['$ref'] !== 'string' ||
      !current['$ref'].startsWith('#/')
    ) {
      break;
    }
    current = followRef(current['$ref'], doc);
  }
  return current;
}

function deepFields(
  node: unknown,
  doc: OpenApiDoc,
  out: Set<string>,
  seen = new Set<string>(),
): Set<string> {
  if (isObject(node)) {
    const ref = node['$ref'];
    if (typeof ref === 'string' && ref.startsWith('#/') && !seen.has(ref)) {
      seen.add(ref);
      deepFields(followRef(ref, doc), doc, out, seen);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && isObject(value)) {
        for (const name of Object.keys(value)) out.add(name);
      }
      if (key === 'headers' && isObject(value)) {
        for (const name of Object.keys(value)) out.add(name);
      }
      if (key === 'name' && typeof value === 'string') out.add(value);
      deepFields(value, doc, out, seen);
    }
  } else if (Array.isArray(node)) {
    for (const value of node) deepFields(value, doc, out, seen);
  }
  return out;
}

type TokenSite = `${string}|${string}|${string}|${string}`;

function siteKey(oid: string, transport: string, where: string, field: string): TokenSite {
  return `${oid}|${transport}|${where}|${field}`;
}

function placement(doc: OpenApiDoc): { sites: Set<TokenSite>; bearer: Record<string, string[]> } {
  const sites = new Set<TokenSite>();
  const bearer: Record<string, string[]> = {};
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    if (!isObject(methods)) continue;
    for (const [method, rawOp] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method) || !isObject(rawOp)) continue;
      const oid =
        typeof rawOp['operationId'] === 'string' ? rawOp['operationId'] : `${method} ${path}`;
      const sec = Array.isArray(rawOp['security'])
        ? rawOp['security']
        : Array.isArray(doc.security)
          ? doc.security
          : [];
      bearer[oid] = [
        ...new Set(sec.flatMap((req) => (isObject(req) ? Object.keys(req) : []))),
      ].sort();
      const responses = isObject(rawOp['responses']) ? rawOp['responses'] : {};
      for (const [code, rawResponse] of Object.entries(responses)) {
        const resolved = deref(rawResponse, doc);
        const body = deepFields(isObject(resolved) ? resolved['content'] : {}, doc, new Set());
        const headers =
          isObject(resolved) && isObject(resolved['headers']) ? resolved['headers'] : {};
        const headerNames = new Set<string>([
          ...Object.keys(headers).map((name) => name.toLowerCase()),
          ...[...deepFields(headers, doc, new Set())].map((name) => name.toLowerCase()),
          ...Object.values(headers).flatMap((header) => {
            if (!isObject(header) || typeof header['$ref'] !== 'string') return [];
            return [header['$ref'].split('/').at(-1)?.toLowerCase() ?? ''];
          }),
        ]);
        for (const field of TOKEN_FIELDS) {
          if (body.has(field)) sites.add(siteKey(oid, 'response', String(code), field));
          if (headerNames.has(field.toLowerCase())) {
            sites.add(siteKey(oid, 'response-header', String(code), field));
          }
        }
      }
      const requestBody = deref(rawOp['requestBody'] ?? {}, doc);
      const requestFields = deepFields(
        isObject(requestBody) ? requestBody['content'] : {},
        doc,
        new Set(),
      );
      const paramFields = new Set<string>([
        ...deepFields(rawOp['parameters'] ?? [], doc, new Set()),
        ...deepFields(methods['parameters'] ?? [], doc, new Set()),
      ]);
      for (const field of TOKEN_FIELDS) {
        if (requestFields.has(field)) sites.add(siteKey(oid, 'request', 'body', field));
        if (paramFields.has(field)) sites.add(siteKey(oid, 'request', 'parameter', field));
      }
    }
  }
  return { sites, bearer };
}

function xor<T>(left: Set<T>, right: Set<T>): T[] {
  return [...left, ...right].filter((item) => left.has(item) !== right.has(item));
}

function extractRule(description: string, rule: 'R1' | 'R2' | 'R3'): string | undefined {
  const collapsed = description.split(/\s+/).join(' ');
  const match = collapsed.match(new RegExp(`\\(${rule},.*?(?= \\(R[0-9],| DL-14|$)`));
  return match?.[0];
}

export function checkV11Pin(bytes: Uint8Array | Buffer): string[] {
  const actual = sha256Bytes(bytes);
  return actual === PINNED_V1_1_0 ? [] : [`v1.1.0 sha ${actual} != pinned ${PINNED_V1_1_0}`];
}

export function checkOpenApiV12Scope(v11raw: unknown, v12raw: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(v11raw) || !isObject(v12raw)) return ['both documents must be OpenAPI objects'];
  const v11 = v11raw as OpenApiDoc;
  const v12 = v12raw as OpenApiDoc;

  if (!deepEqual([...Object.keys(v11)].sort(), [...Object.keys(v12)].sort())) {
    const left = new Set(Object.keys(v11));
    const right = new Set(Object.keys(v12));
    errors.push(`top-level keys differ: ${xor(left, right).join(',')}`);
  }
  for (const key of Object.keys(v11)) {
    if (
      key !== 'info' &&
      key !== 'paths' &&
      key !== 'components' &&
      !deepEqual(v11[key as keyof OpenApiDoc], v12[key as keyof OpenApiDoc])
    ) {
      errors.push(`top-level ${key} changed`);
    }
  }

  const info11 = { ...(v11.info ?? {}) };
  const info12 = { ...(v12.info ?? {}) };
  for (const key of ['version', 'x-freeze-status', 'description']) {
    delete info11[key];
    delete info12[key];
  }
  if (!deepEqual(info11, info12))
    errors.push('info changed outside version/x-freeze-status/description');
  if (v12.info?.['version'] !== '1.2.0') errors.push('info.version != 1.2.0');
  const freeze = String(v12.info?.['x-freeze-status'] ?? '')
    .split('(')[0]
    ?.trim()
    .toLowerCase();
  if (freeze !== 'candidate' && freeze !== 'frozen') {
    errors.push(`x-freeze-status unexpected: ${JSON.stringify(freeze)}`);
  }

  const c11 = v11.components ?? {};
  const c12 = v12.components ?? {};
  if (!deepEqual(Object.keys(c11).sort(), Object.keys(c12).sort())) {
    errors.push('components sections differ');
  }
  for (const key of Object.keys(c11)) {
    if (key !== 'schemas' && !deepEqual(c11[key], c12[key]))
      errors.push(`components.${key} changed`);
  }

  const schemas11 = isObject(c11['schemas']) ? (c11['schemas'] as Record<string, JsonObject>) : {};
  const schemas12 = isObject(c12['schemas']) ? (c12['schemas'] as Record<string, JsonObject>) : {};
  const paths11 = v11.paths ?? {};
  const paths12 = v12.paths ?? {};
  if (!deepEqual(Object.keys(paths11).sort(), Object.keys(paths12).sort())) {
    errors.push(
      `paths differ: ${[...new Set([...Object.keys(paths11), ...Object.keys(paths12)])].join(',')}`,
    );
  }

  const allowedRefs = new Set<string>();
  const otherRefs = new Set<string>();
  const ops: Record<string, JsonObject> = {};

  for (const path of Object.keys(paths11)) {
    if (!(path in paths12)) continue;
    const item11 = paths11[path];
    const item12 = paths12[path];
    if (!isObject(item11) || !isObject(item12)) continue;
    if (!deepEqual(Object.keys(item11).sort(), Object.keys(item12).sort())) {
      errors.push(`${path}: methods differ`);
      continue;
    }
    for (const method of Object.keys(item11)) {
      const left = item11[method];
      const right = item12[method];
      if (!isObject(left) || !isObject(right)) continue;
      const oid = typeof left['operationId'] === 'string' ? left['operationId'] : undefined;
      if (oid) ops[oid] = right;
      if (!oid || !(oid in ALLOWED_REFRESH)) {
        if (!deepEqual(left, right)) {
          errors.push(`${oid ?? `${path} ${method}`}: changed but not in allowed set (A3/B3/C2)`);
        }
        collectSchemaRefs(right, otherRefs);
        continue;
      }
      const strippedLeft = clone(left);
      const strippedRight = clone(right);
      const popSchema = (op: JsonObject) => {
        const responses = isObject(op['responses']) ? op['responses'] : undefined;
        const ok = responses && isObject(responses['200']) ? responses['200'] : undefined;
        const content = ok && isObject(ok['content']) ? ok['content'] : undefined;
        const json =
          content && isObject(content['application/json'])
            ? content['application/json']
            : undefined;
        if (json) delete json['schema'];
      };
      popSchema(strippedLeft);
      popSchema(strippedRight);
      if (!deepEqual(strippedLeft, strippedRight)) {
        errors.push(`${oid}: something other than the 200 response schema changed`);
      }
      const expectedRef = { $ref: `#/components/schemas/${ALLOWED_REFRESH[oid]}` };
      if (!deepEqual(schema200(right), expectedRef)) {
        errors.push(`${oid}: 200 schema must be $ref ${ALLOWED_REFRESH[oid]}`);
      }
      collectSchemaRefs(schema200(right), allowedRefs);
      collectSchemaRefs(
        Object.fromEntries(Object.entries(right).filter(([key]) => key !== 'responses')),
        otherRefs,
      );
      const responses = isObject(right['responses']) ? right['responses'] : {};
      for (const [code, response] of Object.entries(responses)) {
        if (code !== '200') collectSchemaRefs(response, otherRefs);
      }
    }
  }

  for (const name of Object.keys(schemas11)) {
    if (!deepEqual(schemas11[name], schemas12[name]))
      errors.push(`existing schema ${name} changed`);
  }
  const newSchemas = new Set(Object.keys(schemas12).filter((name) => !(name in schemas11)));
  const expectedNew = new Set(Object.keys(REFRESH_BASE));
  if (!deepEqual([...newSchemas].sort(), [...expectedNew].sort())) {
    errors.push(
      `new schemas must be exactly ${[...expectedNew].sort().join(',')}, got ${[...newSchemas].sort().join(',')}`,
    );
  }
  for (const name of [...newSchemas].sort()) checkClosed(schemas12[name], name, errors);
  const leak = [...closure(otherRefs, schemas12)].filter((name) => newSchemas.has(name));
  if (leak.length > 0)
    errors.push(`new schemas referenced outside A3/B3/C2: ${leak.sort().join(',')}`);

  for (const name of [...newSchemas].filter((item) => item in REFRESH_BASE).sort()) {
    const baseName = REFRESH_BASE[name];
    if (!baseName) continue;
    const schema = clone(schemas12[name] ?? {});
    const base = clone(schemas12[baseName] ?? {});
    if (schema['additionalProperties'] !== false) errors.push(`${name}: not closed`);
    const required = Array.isArray(schema['required']) ? schema['required'].map(String) : [];
    const baseRequired = Array.isArray(base['required']) ? base['required'].map(String) : [];
    if (!required.includes('absoluteExpiresAt')) {
      errors.push(`${name}: absoluteExpiresAt must stay required`);
    }
    if (OPT.some((field) => required.includes(field))) {
      errors.push(`${name}: refreshToken/refreshExpiresAt must be optional`);
    }
    const optional = new Set<string>(OPT);
    const expectedRequired = new Set(baseRequired.filter((field: string) => !optional.has(field)));
    if (!deepEqual([...required].sort(), [...expectedRequired].sort())) {
      errors.push(`${name}: required set differs beyond the two RT fields`);
    }
    if (!deepEqual(schema['dependentRequired'], DEPENDENT_REQUIRED)) {
      errors.push(`${name}: dependentRequired must pair refreshToken<->refreshExpiresAt`);
    }
    const props = isObject(schema['properties']) ? Object.keys(schema['properties']) : [];
    const baseProps = isObject(base['properties']) ? Object.keys(base['properties']) : [];
    if (!deepEqual([...props].sort(), [...baseProps].sort())) {
      errors.push(`${name}: property set differs from ${baseName} (no new/echo fields)`);
    }
    if (!String(schema['description'] ?? '').includes('absent = keep the current RT')) {
      errors.push(`${name}: description lacks client rule "absent = keep the current RT"`);
    }
    delete schema['required'];
    delete schema['dependentRequired'];
    delete schema['description'];
    delete base['required'];
    delete base['dependentRequired'];
    delete base['description'];
    for (const field of OPT) {
      const left = isObject(schema['properties']) ? schema['properties'][field] : undefined;
      const right = isObject(base['properties']) ? base['properties'][field] : undefined;
      if (isObject(left)) delete left['description'];
      if (isObject(right)) delete right['description'];
    }
    if (!deepEqual(schema, base)) {
      errors.push(
        `${name}: differs from ${baseName} beyond required/dependentRequired/descriptions`,
      );
    }
  }

  for (const [oid, loginName] of Object.entries(LOGIN)) {
    const op = ops[oid];
    if (!op) {
      errors.push(`${oid}: login operation missing`);
      continue;
    }
    const resolved = resolveSchema(schema200(op), schemas12);
    const required = Array.isArray(resolved['required']) ? resolved['required'].map(String) : [];
    if (!OPT.every((field) => required.includes(field))) {
      errors.push(`${oid}: login 200 must still require refreshToken/refreshExpiresAt`);
    }
    if (!deepEqual(schema200(op), { $ref: `#/components/schemas/${loginName}` })) {
      errors.push(`${oid}: login 200 schema repointed`);
    }
  }

  const placed11 = placement(v11);
  const placed12 = placement(v12);
  if (!deepEqual([...placed11.sites].sort(), [...placed12.sites].sort())) {
    const delta = xor(placed11.sites, placed12.sites).sort();
    errors.push(`token placement changed: ${delta.join(',')}`);
  }
  if (placed12.sites.size !== EXPECTED_TOKEN_SITES) {
    errors.push(`token sites = ${placed12.sites.size}, expected exactly ${EXPECTED_TOKEN_SITES}`);
  }
  if (placed11.sites.size !== EXPECTED_TOKEN_SITES) {
    errors.push(
      `v1.1.0 token sites = ${placed11.sites.size}, expected ${EXPECTED_TOKEN_SITES} (resolver broken?)`,
    );
  }
  if (!deepEqual(placed11.bearer, placed12.bearer)) {
    const changed = Object.keys({ ...placed11.bearer, ...placed12.bearer }).filter(
      (oid) => !deepEqual(placed11.bearer[oid], placed12.bearer[oid]),
    );
    errors.push(`bearer usage changed: ${changed.sort().join(',')}`);
  }
  for (const site of placed12.sites) {
    const [, , where, field] = site.split('|');
    if (where !== '200' && where !== 'body') {
      const [oid] = site.split('|');
      errors.push(`${oid}: ${field} outside a 200 body / request body (${where})`);
    }
  }
  const dumped = JSON.stringify(v12);
  const schemes = isObject(c12['securitySchemes'])
    ? (c12['securitySchemes'] as Record<string, JsonObject>)
    : {};
  if (
    dumped.includes('Set-Cookie') ||
    Object.values(schemes).some(
      (scheme) => scheme['type'] === 'apiKey' && scheme['in'] === 'cookie',
    )
  ) {
    errors.push('cookie-based token transport introduced');
  }
  for (const [oid, op] of Object.entries(ops)) {
    const responses = isObject(op['responses']) ? Object.values(op['responses']) : [];
    const responseFields = new Set<string>();
    for (const response of responses) deepFields(response, v12, responseFields);
    const requestFields = deepFields(op['requestBody'] ?? {}, v12, new Set());
    if (
      (responseFields.has('accessToken') || responseFields.has('refreshToken')) &&
      !TOKEN_RESP.has(oid) &&
      !TOKEN_RESP_DEMO.has(oid)
    ) {
      errors.push(`${oid}: tokens in response not allowed`);
    }
    if (requestFields.has('refreshToken') && !RT_REQ.has(oid)) {
      errors.push(`${oid}: refreshToken in request not allowed`);
    }
  }

  const description11 = String(v11.info?.['description'] ?? '');
  const description12 = String(v12.info?.['description'] ?? '')
    .split(/\s+/)
    .join(' ');
  for (const rule of ['R1', 'R2', 'R3'] as const) {
    const snippet = extractRule(description11, rule);
    if (!snippet) {
      errors.push(`${rule} text not found in v1.1.0`);
      continue;
    }
    if (!description12.includes(snippet)) {
      errors.push(`${rule} normative text missing/altered in v1.2.0 info.description`);
    }
  }

  return errors;
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const openapiDir = join(dirname(fileURLToPath(import.meta.url)), '../openapi');
  const v11Bytes = await readFile(join(openapiDir, 'openapi-v1.1.0.yaml'));
  const pinErrors = checkV11Pin(v11Bytes);
  if (pinErrors.length > 0) {
    process.stderr.write(
      `OpenAPI v1.1.0 → v1.2.0 scope check failed:\n${pinErrors.map((e) => `  - ${e}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  const v11 = parseOpenApiYaml(v11Bytes.toString('utf8'));
  const v12 = parseOpenApiYaml(await readFile(join(openapiDir, 'openapi-v1.2.0.yaml'), 'utf8'));
  const errors = checkOpenApiV12Scope(v11, v12);
  if (errors.length > 0) {
    process.stderr.write(
      `OpenAPI v1.1.0 → v1.2.0 scope check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `OpenAPI v1.1.0 → v1.2.0 scope ok (${Object.keys(ALLOWED_REFRESH).length} refresh operations, ${EXPECTED_TOKEN_SITES} token sites)\n`,
  );
}
