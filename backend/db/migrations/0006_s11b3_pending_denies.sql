CREATE TABLE identity.pending_session_denies (
  sid uuid PRIMARY KEY REFERENCES identity.sessions(sid),
  enqueued_at timestamp with time zone NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  done_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX pending_session_denies_open_idx
  ON identity.pending_session_denies (enqueued_at)
  WHERE done_at IS NULL;
--> statement-breakpoint
ALTER TABLE identity.pending_session_denies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.pending_session_denies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pending_session_denies_identity ON identity.pending_session_denies
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON TABLE identity.pending_session_denies FROM PUBLIC;
--> statement-breakpoint
DO $grants$
DECLARE
  allow_missing boolean := current_setting('vproject.allow_missing_roles', true) = 'on';
  missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    missing := missing || 'vproject_migrator ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    missing := missing || 'vproject_identity ';
  END IF;
  IF missing <> '' AND NOT allow_missing THEN
    RAISE EXCEPTION 'S11b-3 pending denies require roles %', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER TABLE identity.pending_session_denies OWNER TO vproject_migrator;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE identity.pending_session_denies TO vproject_identity;
  END IF;
END
$grants$;
