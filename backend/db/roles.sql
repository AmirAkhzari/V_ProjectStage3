-- Local-only roles for the P0 Foundation skeleton (P0-E4-T1 / AppSec H-1, M-6).
-- Applied only when runMigrations({ applyRoles: true }) is used (tests, scripts/dev.mjs).
-- Hard-fail in production and against non-local hosts. No passwords: login is unused in
-- Foundation tests (the harness connects as the container superuser). Set passwords via
-- the secret manager when these roles are provisioned for real environments.
--
-- vproject_migrator  owns schemas and runs drizzle migrations
-- vproject_app       request path; NOBYPASSRLS; owns no tables; no USAGE on identity
-- vproject_worker    outbox relay / jobs; NOBYPASSRLS
-- vproject_identity  reserved for identity.* ; no grants to vproject_app

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    CREATE ROLE vproject_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  ELSE
    ALTER ROLE vproject_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    CREATE ROLE vproject_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE vproject_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_worker') THEN
    CREATE ROLE vproject_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE vproject_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    CREATE ROLE vproject_identity LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE vproject_identity NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON FUNCTIONS FROM PUBLIC;
