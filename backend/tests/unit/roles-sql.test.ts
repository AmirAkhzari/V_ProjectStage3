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

describe('0002_s11b_identity_tables.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0002_s11b_identity_tables.sql'), 'utf8');

  it('FORCE RLS on S-11b tables and grants identity-only on identity', () => {
    expect(sql).toMatch(/ALTER TABLE identity\.accounts FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE identity\.driver_credentials FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE identity\.staff_memberships FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE tenancy\.distributors FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE customers\.shopkeepers FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/WITH CHECK/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE[\s\S]*identity\.accounts/);
    expect(sql).toMatch(/TO vproject_identity/);
    expect(sql).toMatch(/GRANT SELECT ON TABLE tenancy\.distributors TO vproject_app/);
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE customers\.shopkeepers TO vproject_app/,
    );
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/);
    expect(sql).not.toMatch(/GRANT .* ON TABLE identity\.\w+ TO vproject_app/);
    expect(sql).not.toMatch(/GRANT USAGE ON SCHEMA identity TO vproject_app/);
  });

  it('gives identity INSERT-only on audit_log and outbox_events', () => {
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA platform TO vproject_identity/);
    expect(sql).toMatch(
      /GRANT INSERT ON TABLE platform\.audit_log, platform\.outbox_events TO vproject_identity/,
    );
    expect(sql).not.toMatch(/GRANT SELECT.*platform\.audit_log TO vproject_identity/);
    expect(sql).not.toMatch(/GRANT UPDATE.*platform\.audit_log TO vproject_identity/);
  });

  it('exposes lookup_driver_login instead of relying on is_platform for C1', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION identity\.lookup_driver_login/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.lookup_driver_login\(text\) TO vproject_identity/,
    );
    expect(sql).toMatch(/accounts_username_norm_check/);
    expect(sql).toMatch(/Hash of the successor refresh token/);
    expect(sql).not.toMatch(
      /primary_distributor_id = NULLIF\(current_setting\('app\.distributor_id'/,
    );
    expect(sql).toMatch(/shopkeepers_account_id_unique/);
  });
});

describe('0005_s11b3_staff_login.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0005_s11b3_staff_login.sql'), 'utf8');

  it('exposes SECURITY DEFINER staff/session lookups for identity only', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION identity\.lookup_staff_login/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION identity\.lookup_session/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION identity\.lookup_account_scope/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = identity, pg_temp/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.lookup_staff_login\(text\) TO vproject_identity/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.lookup_session\(uuid\) TO vproject_identity/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.lookup_account_scope\(uuid\) TO vproject_identity/,
    );
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION identity\.lookup_staff_login\(text\) FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION identity\.lookup_session\(uuid\) FROM PUBLIC/);
    expect(sql).toMatch(/CREATE POLICY staff_memberships_login_lookup/);
    expect(sql).toMatch(/accounts_typ_check/);
    expect(sql).toMatch(/accounts_status_check/);
    expect(sql).toMatch(/staff_memberships_role_check/);
    expect(sql).toMatch(/staff_memberships_sa_distributor_check/);
    expect(sql).not.toMatch(/GRANT EXECUTE .* TO vproject_app/);
  });
});

describe('0006_s11b3_pending_denies.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0006_s11b3_pending_denies.sql'), 'utf8');

  it('FORCE RLS and grants identity-only on pending_session_denies', () => {
    expect(sql).toMatch(/ALTER TABLE identity\.pending_session_denies FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY pending_session_denies_identity/);
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE identity\.pending_session_denies TO vproject_identity/,
    );
    expect(sql).not.toMatch(/GRANT .* ON TABLE identity\.pending_session_denies TO vproject_app/);
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/);
  });
});

describe('0007_s11b4b_pending_denies_purge.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0007_s11b4b_pending_denies_purge.sql'), 'utf8');

  it('grants DELETE on pending_session_denies to identity only', () => {
    expect(sql).toMatch(
      /GRANT DELETE ON TABLE identity\.pending_session_denies TO vproject_identity/,
    );
    expect(sql).not.toMatch(/GRANT .*pending_session_denies TO vproject_app/);
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/);
  });
});
