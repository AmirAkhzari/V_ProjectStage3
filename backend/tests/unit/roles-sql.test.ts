import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../../db');

describe('local roles.sql', () => {
  it('contains no PASSWORD clauses and revokes PUBLIC defaults', () => {
    const sql = readFileSync(join(dbDir, 'roles.sql'), 'utf8');
    expect(sql).not.toMatch(/\bPASSWORD\b/i);
    expect(sql).not.toMatch(/harness connects as the container superuser/);
    expect(sql).toMatch(/vproject_app \(NOBYPASSRLS\)/);
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

describe('0001_platform_infra.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0001_platform_infra.sql'), 'utf8');

  it('fails closed when roles are missing unless allow_missing_roles is on', () => {
    expect(sql).toMatch(/current_setting\('vproject\.allow_missing_roles'/);
    expect(sql).toMatch(/RAISE EXCEPTION 'platform infra migration requires roles/);
  });

  it('does not grant vproject_app SELECT on outbox_events', () => {
    expect(sql).not.toMatch(/GRANT SELECT ON TABLE platform\.outbox_events TO vproject_app/);
    expect(sql).toMatch(
      /GRANT INSERT ON TABLE platform\.outbox_events, platform\.inbox_processed, platform\.audit_log TO vproject_app/,
    );
    expect(sql).toMatch(/GRANT SELECT, UPDATE ON TABLE platform\.outbox_events TO vproject_worker/);
    expect(sql).toMatch(
      /GRANT SELECT, INSERT ON TABLE platform\.inbox_processed TO vproject_worker/,
    );
    expect(sql).not.toMatch(/idempotency_keys TO vproject_worker/);
    expect(sql).not.toMatch(
      /GRANT SELECT, UPDATE ON TABLE platform\.outbox_events, platform\.inbox_processed TO vproject_worker/,
    );
  });

  it('exposes a SECURITY DEFINER boolean lag probe instead of table SELECT', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION platform\.outbox_lag_exceeded\(max_lag_ms integer\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION platform\.outbox_lag_exceeded\(integer\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION platform\.outbox_lag_exceeded\(integer\) TO vproject_app/,
    );
  });
});
