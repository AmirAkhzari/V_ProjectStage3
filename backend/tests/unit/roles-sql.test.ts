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

describe('0008_s11b5a_otp_http.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0008_s11b5a_otp_http.sql'), 'utf8');

  it('FORCE RLS on otp_challenges and grants identity insert/select only', () => {
    expect(sql).toMatch(/ALTER TABLE identity\.otp_challenges FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY otp_challenges_identity/);
    expect(sql).toMatch(
      /GRANT SELECT, INSERT ON TABLE identity\.otp_challenges TO vproject_identity/,
    );
    expect(sql).not.toMatch(/GRANT .*otp_challenges TO vproject_app/);
    expect(sql).not.toMatch(/GRANT .*customers\.shopkeepers TO vproject_identity/);
    expect(sql).not.toMatch(/ensure_shopkeeper_account/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.lookup_staff_otp\(text\) TO vproject_identity/,
    );
    expect(sql).toMatch(/SET search_path = identity, pg_temp/);
  });
});

describe('0009_s11b5a_otp_verify.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0009_s11b5a_otp_verify.sql'), 'utf8');

  it('SECURITY DEFINER shopkeeper ensure; no shopkeepers GRANT to identity', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.ensure_shopkeeper_account\(text\) TO vproject_identity/,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION identity\.lookup_staff_otp/);
    expect(sql).toMatch(/tenancy\.distributors/);
    expect(sql).toMatch(/distributors_otp_lookup/);
    expect(sql).toMatch(/staff_memberships_otp_lock/);
    expect(sql).toMatch(/staff_otp_membership/);
    expect(sql).toMatch(/distributor_status/);
    expect(sql).toMatch(/FOR UPDATE OF sm/);
    expect(sql).not.toMatch(/GRANT .*customers\.shopkeepers TO vproject_identity/);
    expect(sql).toMatch(/SET search_path = identity, customers, pg_temp/);
    expect(sql).toMatch(/set_config\('app\.shopkeeper_id'/);
    expect(sql).not.toMatch(/app\.is_platform/);
    expect(sql).not.toMatch(/SELECT INTO/);
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

describe('0012_s11b7_b27_profile_update.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0012_s11b7_b27_profile_update.sql'), 'utf8');

  it('grants column-level UPDATE on name only and keeps status/INSERT/DELETE out of reach', () => {
    expect(sql).toMatch(/GRANT UPDATE \(name\) ON TABLE tenancy\.distributors TO vproject_app/);
    expect(sql).not.toMatch(/GRANT UPDATE ON TABLE tenancy\.distributors TO vproject_app/);
    expect(sql).not.toMatch(/GRANT [^;]*\bINSERT\b[^;]*tenancy\.distributors TO vproject_app/);
    expect(sql).not.toMatch(/GRANT [^;]*\bDELETE\b[^;]*tenancy\.distributors TO vproject_app/);
    expect(sql).toMatch(/CREATE POLICY distributors_update_own ON tenancy\.distributors/);
    expect(sql).toMatch(/app\.distributor_id/);
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/);
  });
});

describe('0017_s12_a8_shopkeeper_name.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0017_s12_a8_shopkeeper_name.sql'), 'utf8');

  it('adds the nullable name column and only that column to the app role grant', () => {
    expect(sql).toMatch(/ALTER TABLE customers\.shopkeepers ADD COLUMN name text/);
    expect(sql).toMatch(/GRANT UPDATE \(name\) ON customers\.shopkeepers TO vproject_app/);
    expect(sql).not.toMatch(/GRANT UPDATE ON customers\.shopkeepers/);
    expect(sql).not.toMatch(/GRANT [^;]*\b(INSERT|DELETE)\b[^;]*customers\.shopkeepers/);
    // The policy itself is 0002's `shopkeepers_tenant`; this slice must not widen it.
    expect(sql).not.toMatch(/CREATE POLICY/);
  });
});

describe('0018_s12_a9_a10_addresses.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0018_s12_a9_a10_addresses.sql'), 'utf8');

  it('creates a FORCE-RLS address book scoped to the owning shop', () => {
    expect(sql).toMatch(/CREATE TABLE customers\.addresses/);
    expect(sql).toMatch(/shopkeeper_id uuid NOT NULL REFERENCES customers\.shopkeepers\(id\)/);
    expect(sql).toMatch(/ALTER TABLE customers\.addresses FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY addresses_tenant ON customers\.addresses/);
    expect(sql).toMatch(/shopkeeper_id = NULLIF\(current_setting\('app\.shopkeeper_id'/);
    expect(sql).toMatch(/addresses_shopkeeper_created_idx/);
  });

  it('grants SELECT/INSERT only and the default pointer, never UPDATE/DELETE', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT ON customers\.addresses TO vproject_app/);
    expect(sql).toMatch(
      /GRANT UPDATE \(default_address_id\) ON customers\.shopkeepers TO vproject_app/,
    );
    expect(sql).not.toMatch(/GRANT [^;]*UPDATE[^;]*customers\.addresses[^;]*vproject_app/);
    expect(sql).not.toMatch(/GRANT [^;]*DELETE[^;]*customers\.addresses/);
    expect(sql).not.toMatch(/GRANT UPDATE ON customers\.shopkeepers/);
    expect(sql).toMatch(/ADD COLUMN default_address_id uuid REFERENCES customers\.addresses/);
  });
});

describe('0019_s12_a11_a13_addresses_edit_delete.sql', () => {
  const sql = readFileSync(
    join(dbDir, 'migrations/0019_s12_a11_a13_addresses_edit_delete.sql'),
    'utf8',
  );

  it('adds the soft-delete column and only the address columns to the app role grant', () => {
    expect(sql).toMatch(
      /ALTER TABLE customers\.addresses ADD COLUMN deleted_at timestamp with time zone/,
    );
    expect(sql).toMatch(
      /GRANT UPDATE \([^)]*deleted_at[^)]*\)\s*ON customers\.addresses TO vproject_app/,
    );
    expect(sql).not.toMatch(/GRANT UPDATE ON customers\.addresses/);
    // The owner and the immutable columns stay out of the grant.
    expect(sql).not.toMatch(
      /GRANT [^;]*\b(id|shopkeeper_id|created_at)\b\s*,?[^;]*ON customers\.addresses/,
    );
    expect(sql).not.toMatch(/GRANT [^;]*DELETE[^;]*customers\.addresses/);
    // 0018's `addresses_tenant` already covers UPDATE; this slice must not add or widen a policy.
    expect(sql).not.toMatch(/CREATE POLICY|ALTER POLICY|DROP POLICY/);
  });
});

describe('0020_s12_a16_primary_distributor.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0020_s12_a16_primary_distributor.sql'), 'utf8');

  it('adds the shopkeeper read scope on active distributors and no new grant', () => {
    expect(sql).toMatch(/CREATE POLICY distributors_shopkeeper_read ON tenancy\.distributors/);
    expect(sql).toMatch(/FOR SELECT/);
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/app\.shopkeeper_id/);
    // A16's write already has 0016's column grant and 0002's own-row policy: nothing to widen.
    expect(sql).not.toMatch(/GRANT/);
    expect(sql).not.toMatch(/ALTER TABLE|CREATE TABLE/);
  });
});

describe('0010_s11b6_demo_login.sql', () => {
  const sql = readFileSync(join(dbDir, 'migrations/0010_s11b6_demo_login.sql'), 'utf8');

  it('adds is_demo, keeps FORCE RLS, and does not grant the table to the app role', () => {
    expect(sql).toMatch(/ADD COLUMN is_demo boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE identity\.accounts FROM vproject_app/);
    expect(sql).toMatch(/a\.is_demo = false/);
    expect(sql).toMatch(/lookup_demo_account/);
    expect(sql).not.toMatch(/GRANT .*identity\.accounts TO vproject_app/);
  });
});
