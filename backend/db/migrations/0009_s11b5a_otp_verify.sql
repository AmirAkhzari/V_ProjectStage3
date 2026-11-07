CREATE OR REPLACE FUNCTION identity.ensure_shopkeeper_account(p_phone text)
RETURNS TABLE (account_id uuid, is_new boolean, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = identity, customers, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  RETURN QUERY
    SELECT a.id, false, a.status
      FROM identity.accounts a
     WHERE a.phone = p_phone AND a.typ = 'shopkeeper';
  IF FOUND THEN
    RETURN;
  END IF;
  new_id := gen_random_uuid();
  PERFORM set_config('app.shopkeeper_id', new_id::text, true);
  INSERT INTO identity.accounts
    (id, typ, phone, status, session_version, must_change_password, created_at)
  VALUES (new_id, 'shopkeeper', p_phone, 'active', 0, false, clock_timestamp());
  INSERT INTO customers.shopkeepers
    (id, account_id, phone, primary_distributor_id, status, created_at)
  VALUES (new_id, new_id, p_phone, NULL, 'active', clock_timestamp());
  account_id := new_id;
  is_new := true;
  status := 'active';
  RETURN NEXT;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY
    SELECT a.id, false, COALESCE(a.status, 'inactive')
      FROM identity.accounts a
     WHERE a.phone = p_phone AND a.typ = 'shopkeeper';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.ensure_shopkeeper_account(text) FROM PUBLIC;
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
    RAISE EXCEPTION 'S11b-5a otp verify migration requires roles %', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER FUNCTION identity.ensure_shopkeeper_account(text) OWNER TO vproject_migrator;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT EXECUTE ON FUNCTION identity.ensure_shopkeeper_account(text) TO vproject_identity;
  END IF;
END
$grants$;
