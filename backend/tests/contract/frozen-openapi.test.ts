import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PINNED_SHA256 = 'ef2a2fffe53b23b026b908924810f954d2b7010aa11b62cfdf79c9fb62a6175a';
const dir = join(dirname(fileURLToPath(import.meta.url)), '../../openapi');

describe('frozen OpenAPI artifact', () => {
  it('matches the DECISION_LOG pinned sha256', () => {
    const yaml = readFileSync(join(dir, 'openapi-v1.0.0.yaml'));
    const sidecar = readFileSync(join(dir, 'openapi-v1.0.0.yaml.sha256'), 'utf8')
      .trim()
      .split(/\s+/)[0];
    const actual = createHash('sha256').update(yaml).digest('hex');
    expect(sidecar).toBe(PINNED_SHA256);
    expect(actual).toBe(PINNED_SHA256);
  });
});
