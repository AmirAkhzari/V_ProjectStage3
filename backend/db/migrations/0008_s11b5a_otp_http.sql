CREATE TABLE identity.otp_challenges (
  id uuid PRIMARY KEY,
  purpose text NOT NULL,
  phone_hmac text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('app', 'staff'))
);
--> statement-breakpoint
CREATE INDEX otp_challenges_created_at_idx ON identity.otp_challenges USING btree (created_at);
--> statement-breakpoint
ALTER TABLE identity.otp_challenges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.otp_challenges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY otp_challenges_identity ON identity.otp_challenges
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION identity.lookup_staff_otp(p_phone text)
RETURNS TABLE (
  account_id uuid,
  role text,
  distributor_id uuid,
  status text,
  permissions text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = identity, pg_temp
AS $$
  SELECT a.id, sm.role, sm.distributor_id, a.status, sm.permissions
  FROM identity.accounts a
  INNER JOIN identity.staff_memberships sm ON sm.account_id = a.id
  WHERE a.phone = p_phone
    AND a.typ = 'staff';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.lookup_staff_otp(text) FROM PUBLIC;
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
    RAISE EXCEPTION 'S11b-5a otp http migration requires roles %', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER TABLE identity.otp_challenges OWNER TO vproject_migrator;
    ALTER FUNCTION identity.lookup_staff_otp(text) OWNER TO vproject_migrator;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT SELECT, INSERT ON TABLE identity.otp_challenges TO vproject_identity;
    GRANT EXECUTE ON FUNCTION identity.lookup_staff_otp(text) TO vproject_identity;
  END IF;
END
$grants$;
