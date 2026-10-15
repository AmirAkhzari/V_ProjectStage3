import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const backendRoot = join(import.meta.dirname, '../..');

describe('module boundary rules', () => {
  it('fails as expected when ordering imports catalog/infra', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vproject-boundary-'));
    const file = join(dir, 'leak.ts');
    writeFileSync(
      file,
      `import { catalogSchema } from '${join(backendRoot, 'src/modules/catalog/infra/db/schema.ts')}';\nexport const leak = catalogSchema;\n`,
    );

    const violation = join(backendRoot, 'src/modules/ordering/__boundary_violation__.ts');
    writeFileSync(
      violation,
      "import { catalogSchema } from '../catalog/infra/db/schema.js';\nexport const leak = catalogSchema;\n",
    );

    try {
      const result = spawnSync(
        'pnpm',
        [
          'exec',
          'depcruise',
          'src/modules/ordering/__boundary_violation__.ts',
          '--config',
          '.dependency-cruiser.cjs',
        ],
        { cwd: backendRoot, encoding: 'utf8' },
      );
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toMatch(/no-internals-of-catalog|error/i);
    } finally {
      rmSync(violation, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
