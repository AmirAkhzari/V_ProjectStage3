#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pinned in DECISION_LOG §I F10. Changing the yaml and the .sha256 sidecar together must still fail. */
const PINNED_SHA256 = 'ef2a2fffe53b23b026b908924810f954d2b7010aa11b62cfdf79c9fb62a6175a';

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
if (expectedHash !== PINNED_SHA256) {
  process.stderr.write(
    `frozen OpenAPI sidecar sha256 is not the DECISION_LOG pin\n  pinned: ${PINNED_SHA256}\n  sidecar: ${expectedHash}\n`,
  );
  process.exit(1);
}
if (actual !== PINNED_SHA256) {
  process.stderr.write(
    `frozen OpenAPI sha256 mismatch\n  expected: ${PINNED_SHA256}\n  actual:   ${actual}\n`,
  );
  process.exit(1);
}

process.stdout.write(`frozen OpenAPI sha256 ok (${actual})\n`);
