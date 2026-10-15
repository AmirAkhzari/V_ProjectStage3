-- Local-only roles for the P0 Foundation skeleton (P0-E4-T1).
-- Managed Postgres (DL-05 ArvanCloud) may restrict role creation / NOBYPASSRLS; do not apply this
-- file outside a local compose / Testcontainers database.
--
-- vproject_migrator  owns schemas and runs drizzle migrations
-- vproject_app       request path; NOBYPASSRLS; owns no tables
-- vproject_worker    outbox relay / jobs; NOBYPASSRLS
-- vproject_identity  reserved for identity.* (AppSec H); no grants on identity yet (empty schema)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    CREATE ROLE vproject_migrator LOGIN PASSWORD 'vproject_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    CREATE ROLE vproject_app LOGIN PASSWORD 'vproject_app' NOBYPASSRLS;
  ELSE
    ALTER ROLE vproject_app NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_worker') THEN
    CREATE ROLE vproject_worker LOGIN PASSWORD 'vproject_worker' NOBYPASSRLS;
  ELSE
    ALTER ROLE vproject_worker NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    CREATE ROLE vproject_identity LOGIN PASSWORD 'vproject_identity' NOBYPASSRLS;
  ELSE
    ALTER ROLE vproject_identity NOBYPASSRLS;
  END IF;
END
$$;
