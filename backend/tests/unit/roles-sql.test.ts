import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../../db');

describe('local roles.sql', () => {
  it('contains no PASSWORD clauses and revokes PUBLIC defaults', () => {
    const sql = readFileSync(join(dbDir, 'roles.sql'), 'utf8');
    expect(sql).not.toMatch(/\bPASSWORD\b/i);
    expect(sql).toMatch(/NOSUPERUSER/);
    expect(sql).toMatch(/NOCREATEDB/);
    expect(sql).toMatch(/NOCREATEROLE/);
    expect(sql).toMatch(/NOREPLICATION/);
    expect(sql).toMatch(/NOBYPASSRLS/);
    expect(sql).toMatch(/REVOKE ALL ON DATABASE/);
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA public FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON TABLES FROM PUBLIC/,
    );
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  });
});
