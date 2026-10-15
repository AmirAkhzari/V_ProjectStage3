#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ALLOWED_TABLES, SCHEMAS, checkMigrationSql } from './drift-policy.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const migrationsDir = join(ROOT, 'db/migrations');
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  process.stderr.write('no SQL migrations found\n');
  process.exit(1);
}

const combined = (
  await Promise.all(files.map((f) => readFile(join(migrationsDir, f), 'utf8')))
).join('\n');

const errors = checkMigrationSql(combined);

if (errors.length > 0) {
  process.stderr.write(
    `migration drift/policy check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `migration check ok (${files.length} sql file(s), ${SCHEMAS.length} schemas, ${ALLOWED_TABLES.size} platform infra tables)\n`,
);
