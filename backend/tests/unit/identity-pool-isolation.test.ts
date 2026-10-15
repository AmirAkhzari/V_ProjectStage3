import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const backendRoot = join(import.meta.dirname, '../..');

describe('identity pool isolation (AppSec 7-6)', () => {
  it('fails when a non-identity module imports the identity pool helper', () => {
    const violation = join(backendRoot, 'src/modules/catalog/__identity_pool_violation__.ts');
    writeFileSync(
      violation,
      "import { createIdentityDb } from '../identity/infra/db/pool.js';\nexport const leak = createIdentityDb;\n",
    );
    try {
      const result = spawnSync(
        'pnpm',
        [
          'exec',
          'depcruise',
          'src/modules/catalog/__identity_pool_violation__.ts',
          '--config',
          '.dependency-cruiser.cjs',
        ],
        { cwd: backendRoot, encoding: 'utf8' },
      );
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toMatch(/identity-pool-isolation/);
    } finally {
      rmSync(violation, { force: true });
    }
  });
});
