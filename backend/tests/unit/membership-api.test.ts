import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMembershipApi } from '../../src/modules/membership/api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('membership public API surface', () => {
  it('exposes only monthlyPrice', () => {
    expect(Object.keys(createMembershipApi())).toEqual(['monthlyPrice']);
  });

  it('keeps activatePeriod out of every module except its own application file', () => {
    const allowed = 'src/modules/membership/application/activateSubscription.ts';
    const matches = sourceFiles(join(root, 'src'))
      .filter((path) => readFileSync(path, 'utf8').includes('activatePeriod'))
      .map((path) => relative(root, path).replaceAll('\\', '/'));
    expect(matches).toEqual([allowed]);
  });
});
