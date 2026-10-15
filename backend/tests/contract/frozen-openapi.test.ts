import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../openapi');

describe('frozen OpenAPI artifact', () => {
  it('matches the committed sha256', () => {
    const yaml = readFileSync(join(dir, 'openapi-v1.0.0.yaml'));
    const expected = readFileSync(join(dir, 'openapi-v1.0.0.yaml.sha256'), 'utf8')
      .trim()
      .split(/\s+/)[0];
    expect(createHash('sha256').update(yaml).digest('hex')).toBe(expected);
  });
});
