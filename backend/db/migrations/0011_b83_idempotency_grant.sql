-- B83: completed Idempotency-Key is written on the identity pool in the audit transaction. No schema change.
DO $grants$
DECLARE
  allow_missing boolean := current_setting('vproject.allow_missing_roles', true) = 'on';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    IF NOT allow_missing THEN
      RAISE EXCEPTION 'B83 idempotency migration requires role vproject_identity';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT USAGE ON SCHEMA platform TO vproject_identity;
    GRANT SELECT, INSERT, UPDATE ON TABLE platform.idempotency_keys TO vproject_identity;
  END IF;
END
$grants$;
