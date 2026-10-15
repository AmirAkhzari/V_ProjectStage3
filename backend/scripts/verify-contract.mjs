#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const openapiDir = join(dirname(fileURLToPath(import.meta.url)), '../openapi');
const yamlPath = join(openapiDir, 'openapi-v1.0.0.yaml');
const shaPath = join(openapiDir, 'openapi-v1.0.0.yaml.sha256');

const yaml = await readFile(yamlPath);
const expectedLine = (await readFile(shaPath, 'utf8')).trim();
const [expectedHash, expectedName] = expectedLine.split(/\s+/);
const actual = createHash('sha256').update(yaml).digest('hex');

if (expectedName && expectedName !== 'openapi-v1.0.0.yaml') {
  process.stderr.write(`checksum filename mismatch: ${expectedName}\n`);
  process.exit(1);
}
if (actual !== expectedHash) {
  process.stderr.write(
    `frozen OpenAPI sha256 mismatch\n  expected: ${expectedHash}\n  actual:   ${actual}\n`,
  );
  process.exit(1);
}

process.stdout.write(`frozen OpenAPI sha256 ok (${actual})\n`);
