import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(import.meta.dirname, '../../src');
const FORBIDDEN = /set_config\(\s*['"]app\.is_platform['"]/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (path.endsWith('.ts')) acc.push(path);
  }
  return acc;
}

describe('is_platform lint (AppSec 7-7)', () => {
  it('does not set app.is_platform via set_config in src', () => {
    const hits: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      if (FORBIDDEN.test(text)) hits.push(file.slice(srcRoot.length + 1));
    }
    expect(hits).toEqual([]);
  });
});
