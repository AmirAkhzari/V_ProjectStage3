#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pinned in DECISION_LOG §I F10. Changing the yaml and the .sha256 sidecar together must still fail. */
export const PINNED_V1_0_0 = 'ef2a2fffe53b23b026b908924810f954d2b7010aa11b62cfdf79c9fb62a6175a';
/** Pinned in DECISION_LOG §I FREEZE v1.1.0 (Amir 2026-10-15). */
export const PINNED_V1_1_0 = 'a62e4465f24e3dd18e9200472966d130f40bad196e21c8bee024d8948cdbd0b1';

const openapiDir = join(dirname(fileURLToPath(import.meta.url)), '../openapi');

const ARTIFACTS = [
  { file: 'openapi-v1.0.0.yaml', pin: PINNED_V1_0_0 },
  { file: 'openapi-v1.1.0.yaml', pin: PINNED_V1_1_0 },
];

export async function verifyFrozenArtifact(file, pin, dir = openapiDir) {
  const yamlPath = join(dir, file);
  const shaPath = join(dir, `${file}.sha256`);
  const yaml = await readFile(yamlPath);
  const expectedLine = (await readFile(shaPath, 'utf8')).trim();
  const [expectedHash, expectedName] = expectedLine.split(/\s+/);
  const actual = createHash('sha256').update(yaml).digest('hex');
  const errors = [];
  if (expectedName && expectedName !== file) {
    errors.push(`${file}: checksum filename mismatch: ${expectedName}`);
  }
  if (expectedHash !== pin) {
    errors.push(
      `${file}: sidecar sha256 is not the DECISION_LOG pin\n  pinned: ${pin}\n  sidecar: ${expectedHash}`,
    );
  }
  if (actual !== pin) {
    errors.push(`${file}: sha256 mismatch\n  expected: ${pin}\n  actual:   ${actual}`);
  }
  return { actual, errors };
}

async function main() {
  let failed = false;
  for (const artifact of ARTIFACTS) {
    const { actual, errors } = await verifyFrozenArtifact(artifact.file, artifact.pin);
    if (errors.length > 0) {
      failed = true;
      process.stderr.write(`${errors.join('\n')}\n`);
      continue;
    }
    process.stdout.write(`frozen ${artifact.file} sha256 ok (${actual})\n`);
  }
  if (failed) process.exit(1);
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  await main();
}
