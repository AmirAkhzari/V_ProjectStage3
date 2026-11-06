-- S11b-4b: identity may DELETE done pending_session_denies rows (purge).
-- 0006 keeps SELECT, INSERT, UPDATE only; DELETE is a separate grant.

DO $grants$
DECLARE
  allow_missing boolean := current_setting('vproject.allow_missing_roles', true) = 'on';
  missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    missing := missing || 'vproject_identity ';
  END IF;
  IF missing <> '' AND NOT allow_missing THEN
    RAISE EXCEPTION 'S11b-4b pending denies purge requires roles %', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT DELETE ON TABLE identity.pending_session_denies TO vproject_identity;
  END IF;
END
$grants$;
