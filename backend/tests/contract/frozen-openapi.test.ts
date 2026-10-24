import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../openapi');

const ARTIFACTS = [
  {
    file: 'openapi-v1.0.0.yaml',
    pin: 'ef2a2fffe53b23b026b908924810f954d2b7010aa11b62cfdf79c9fb62a6175a',
  },
  {
    file: 'openapi-v1.1.0.yaml',
    pin: 'a62e4465f24e3dd18e9200472966d130f40bad196e21c8bee024d8948cdbd0b1',
  },
  {
    file: 'openapi-v1.2.0.yaml',
    pin: 'e3dc40d5a8755d2639b77415f321bf9b7c852a7f6e4f3bb23c5102165e054601',
  },
] as const;

describe('frozen OpenAPI artifacts', () => {
  it.each(ARTIFACTS)('$file matches the DECISION_LOG pinned sha256', ({ file, pin }) => {
    const yaml = readFileSync(join(dir, file));
    const sidecar = readFileSync(join(dir, `${file}.sha256`), 'utf8')
      .trim()
      .split(/\s+/)[0];
    const actual = createHash('sha256').update(yaml).digest('hex');
    expect(sidecar).toBe(pin);
    expect(actual).toBe(pin);
  });
});
