import { ESLint } from 'eslint';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const backendRoot = join(import.meta.dirname, '../..');
const catalogFile = join(backendRoot, 'src/modules/catalog/__n1_restricted_syntax__.ts');
const identityFile = join(backendRoot, 'src/modules/identity/__n1_restricted_syntax__.ts');
const tenantPath = join(backendRoot, 'src/platform/db/tenant.ts');

afterEach(() => {
  rmSync(catalogFile, { force: true });
  rmSync(identityFile, { force: true });
});

async function restrictedMessages(file: string, source: string) {
  writeFileSync(file, source);
  try {
    const eslint = new ESLint({ cwd: backendRoot });
    const [result] = await eslint.lintFiles([file]);
    return result?.messages.filter((message) => message.ruleId === 'no-restricted-syntax') ?? [];
  } finally {
    rmSync(file, { force: true });
  }
}

async function restrictedText(filePath: string, source: string) {
  const eslint = new ESLint({ cwd: backendRoot });
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages.filter((message) => message.ruleId === 'no-restricted-syntax') ?? [];
}

describe('eslint restricted syntax (N-1)', () => {
  it("reports 2 errors for process.env['DATABASE_URL_IDENTITY'] outside identity", async () => {
    const messages = await restrictedMessages(
      catalogFile,
      "export const leak = process.env['DATABASE_URL_IDENTITY'];\n",
    );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.message.includes('DATABASE_URL_IDENTITY'))).toBe(
      true,
    );
  });

  it('rejects SET LOCAL app.is_platform in a string literal', async () => {
    const messages = await restrictedMessages(
      catalogFile,
      'export const sql = "SET LOCAL app.is_platform = \'true\'";\n',
    );
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((message) => message.message.includes('is_platform'))).toBe(true);
  });

  it('rejects SET LOCAL app.is_platform in a template string', async () => {
    const messages = await restrictedMessages(
      catalogFile,
      "export const sql = `SET LOCAL app.is_platform = 'true'`;\n",
    );
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((message) => message.message.includes('is_platform'))).toBe(true);
  });

  it('still bans is_platform inside identity code', async () => {
    const messages = await restrictedMessages(
      identityFile,
      'export const sql = "SET LOCAL app.is_platform = \'true\'";\n',
    );
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.every((message) => message.message.includes('is_platform'))).toBe(true);
  });

  it('still bans DATABASE_URL_IDENTITY on the tenant.ts glob', async () => {
    const messages = await restrictedText(
      tenantPath,
      "export const leak = process.env['DATABASE_URL_IDENTITY'];\nexport const guc = 'app.is_platform';\n",
    );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.message.includes('DATABASE_URL_IDENTITY'))).toBe(
      true,
    );
  });
});

describe('eslint devDependency imports', () => {
  it('rejects ajv and yaml imports from src', async () => {
    const eslint = new ESLint({ cwd: backendRoot });
    const [result] = await eslint.lintText(
      "import { Ajv2020 } from 'ajv/dist/2020.js';\nimport { parse } from 'yaml';\nexport const x = { Ajv2020, parse };\n",
      { filePath: join(backendRoot, 'src/modules/identity/application/demoAuth.ts') },
    );
    const messages = result?.messages.filter(
      (message) => message.ruleId === 'no-restricted-imports',
    );
    expect(messages?.length).toBeGreaterThanOrEqual(2);
    expect(messages?.every((message) => message.message.includes('devDependency'))).toBe(true);
  });
});
