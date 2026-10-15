import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PLATFORM_ERROR_CODES } from '../../src/platform/http/errors.js';

const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '../../openapi/openapi-v1.1.0.yaml');

describe('frozen ErrorCode catalogue', () => {
  it('contains every platform-emitted code', () => {
    const doc = parse(readFileSync(yamlPath, 'utf8'), { maxAliasCount: -1 }) as {
      components: { schemas: { ErrorCode: { enum: string[] } } };
    };
    const frozen = new Set(doc.components.schemas.ErrorCode.enum);
    for (const code of PLATFORM_ERROR_CODES) {
      expect(frozen.has(code)).toBe(true);
    }
  });
});
