ALTER TABLE identity.accounts
  ADD CONSTRAINT accounts_typ_check
  CHECK (typ IN ('shopkeeper', 'staff', 'driver'));
--> statement-breakpoint
ALTER TABLE identity.accounts
  ADD CONSTRAINT accounts_status_check
  CHECK (status IN ('active', 'inactive'));
--> statement-breakpoint
ALTER TABLE identity.sessions
  ADD CONSTRAINT sessions_typ_check
  CHECK (typ IN ('shopkeeper', 'staff', 'driver'));
--> statement-breakpoint
ALTER TABLE identity.staff_memberships
  ADD CONSTRAINT staff_memberships_role_check
  CHECK (role IN ('super_admin', 'distributor_admin'));
--> statement-breakpoint
ALTER TABLE identity.staff_memberships
  ADD CONSTRAINT staff_memberships_sa_distributor_check
  CHECK ((role = 'super_admin') = (distributor_id IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION identity.lookup_staff_login(p_phone text)
RETURNS TABLE (
  account_id uuid,
  role text,
  distributor_id uuid,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = identity, pg_temp
AS $$
  SELECT a.id, sm.role, sm.distributor_id, a.status
  FROM identity.accounts a
  INNER JOIN identity.staff_memberships sm ON sm.account_id = a.id
  WHERE a.phone = p_phone
    AND a.typ = 'staff';
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION identity.lookup_session(p_sid uuid)
RETURNS TABLE (
  sid uuid,
  account_id uuid,
  typ text,
  family_id uuid,
  revoked_at timestamptz,
  session_version integer,
  account_status text,
  distributor_id uuid,
  staff_role text,
  permissions text[],
  must_change_password boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = identity, pg_temp
AS $$
  SELECT s.sid, s.account_id, s.typ, s.family_id, s.revoked_at,
         a.session_version, a.status, COALESCE(dc.distributor_id, sm.distributor_id),
         sm.role, sm.permissions, a.must_change_password
  FROM identity.sessions s
  INNER JOIN identity.accounts a ON a.id = s.account_id
  LEFT JOIN identity.driver_credentials dc ON dc.account_id = a.id
  LEFT JOIN identity.staff_memberships sm ON sm.account_id = a.id
  WHERE s.sid = p_sid;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION identity.lookup_account_scope(p_account_id uuid)
RETURNS TABLE (distributor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = identity, pg_temp
AS $$
  SELECT COALESCE(dc.distributor_id, sm.distributor_id)
  FROM identity.accounts a
  LEFT JOIN identity.driver_credentials dc ON dc.account_id = a.id
  LEFT JOIN identity.staff_memberships sm ON sm.account_id = a.id
  WHERE a.id = p_account_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.lookup_staff_login(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.lookup_session(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.lookup_account_scope(uuid) FROM PUBLIC;
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
    RAISE EXCEPTION 'S11b-3 staff login lookup requires roles %', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER FUNCTION identity.lookup_staff_login(text) OWNER TO vproject_migrator;
    ALTER FUNCTION identity.lookup_session(uuid) OWNER TO vproject_migrator;
    ALTER FUNCTION identity.lookup_account_scope(uuid) OWNER TO vproject_migrator;
    CREATE POLICY staff_memberships_login_lookup ON identity.staff_memberships
      FOR SELECT TO vproject_migrator
      USING (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT EXECUTE ON FUNCTION identity.lookup_staff_login(text) TO vproject_identity;
    GRANT EXECUTE ON FUNCTION identity.lookup_session(uuid) TO vproject_identity;
    GRANT EXECUTE ON FUNCTION identity.lookup_account_scope(uuid) TO vproject_identity;
  END IF;
END
$grants$;
