#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCHEMAS = [
  'identity',
  'tenancy',
  'customers',
  'catalog',
  'ordering',
  'delivery',
  'payment',
  'membership',
  'marketing',
  'notification',
  'reporting',
  'platform',
];

/** Architect B-1: platform infrastructure only. No domain tables. */
const ALLOWED_TABLES = new Set([
  'platform.outbox_events',
  'platform.inbox_processed',
  'platform.audit_log',
  'platform.idempotency_keys',
]);

const FORBIDDEN_SQL = [
  { re: /\b(?:numeric|decimal|money)\b/i, msg: 'non-BIGINT money type' },
  { re: /\btimestamp\s+without\s+time\s+zone\b/i, msg: 'timestamp without time zone' },
];

const migrationsDir = join(ROOT, 'db/migrations');
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  process.stderr.write('no SQL migrations found\n');
  process.exit(1);
}

const combined = (
  await Promise.all(files.map((f) => readFile(join(migrationsDir, f), 'utf8')))
).join('\n');

const errors = [];

for (const schema of SCHEMAS) {
  const pattern = new RegExp(`CREATE SCHEMA IF NOT EXISTS ["']?${schema}["']?\\b`, 'i');
  if (!pattern.test(combined)) {
    errors.push(`missing CREATE SCHEMA for ${schema}`);
  }
}

const tableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"?([a-zA-Z_]+)"?\.)?"?([a-zA-Z_]+)"?/gi;
for (const match of combined.matchAll(tableRe)) {
  const schema = match[1] ?? 'public';
  const qualified = `${schema}.${match[2]}`;
  if (!ALLOWED_TABLES.has(qualified)) {
    errors.push(
      `forbidden CREATE TABLE ${qualified}; only ${[...ALLOWED_TABLES].join(', ')} allowed`,
    );
  }
}

for (const rule of FORBIDDEN_SQL) {
  if (rule.re.test(combined)) errors.push(`forbidden SQL: ${rule.msg}`);
}

if (errors.length > 0) {
  process.stderr.write(
    `migration drift/policy check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `migration check ok (${files.length} sql file(s), ${SCHEMAS.length} schemas, ${ALLOWED_TABLES.size} platform infra tables)\n`,
);
