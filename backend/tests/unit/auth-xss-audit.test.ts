import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = join(backendRoot, '../.github/workflows/backend-ci.yml');

describe('AUTH-XSS-02 production dependency audit', () => {
  it('is wired as a CI step and finds no high/critical runtime vulns', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toMatch(/AUTH-XSS-02/);
    expect(workflow).toMatch(/pnpm audit --prod --audit-level=high/);
    const pkg = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['audit:prod']).toMatch(/pnpm audit --prod --audit-level=high/);
    expect(() =>
      execFileSync('pnpm', ['audit', '--prod', '--audit-level=high'], {
        cwd: backendRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
