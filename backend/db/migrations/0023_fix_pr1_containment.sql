-- FIX-PR1 containment (PH-2/P7-4, PH-3, PH-4, PH-12). Forward-only; 0001-0022 are untouched.
--
-- 1. P7-4: the idempotency table has no tenant column, so the binding is the reviewable scope prefix
--    (B27 for the app role, B83 for the identity role) plus the row's own subject. Both are checked
--    against the transaction's GUCs, and USING = WITH CHECK, so an unset GUC matches nothing and an
--    INSERT cannot plant another subject's row. The store sets app.subject_id in the same transaction.
ALTER TABLE platform.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.idempotency_keys FORCE ROW LEVEL SECURITY;

-- 2. Undo the 0022 self-grant: A15 is unmounted in this PR, so the app role no longer inserts
--    periods or payments, and it updates only the three columns A15's dormant writer sets.
--    SELECT stays so A14 keeps reading. Role-guarded like 0022: a cluster without the local roles
--    must still migrate.
DO $fix1$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    REVOKE INSERT ON membership.subscriptions FROM vproject_app;
    REVOKE INSERT, UPDATE ON payment.payments FROM vproject_app;
    GRANT UPDATE (authority, redirect_url, updated_at) ON payment.payments TO vproject_app;

    EXECUTE $p$DROP POLICY IF EXISTS idempotency_keys_app ON platform.idempotency_keys$p$;
    EXECUTE $p$CREATE POLICY idempotency_keys_app ON platform.idempotency_keys
      TO vproject_app
      USING (
        scope LIKE 'B27:%'
        AND subject_id = NULLIF(current_setting('app.subject_id', true), '')
        AND (
          current_setting('app.is_platform', true) = 'true'
          OR scope = 'B27:' || NULLIF(current_setting('app.distributor_id', true), '')
        )
      )
      WITH CHECK (
        scope LIKE 'B27:%'
        AND subject_id = NULLIF(current_setting('app.subject_id', true), '')
        AND (
          current_setting('app.is_platform', true) = 'true'
          OR scope = 'B27:' || NULLIF(current_setting('app.distributor_id', true), '')
        )
      )$p$;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    EXECUTE $p$DROP POLICY IF EXISTS idempotency_keys_identity ON platform.idempotency_keys$p$;
    EXECUTE $p$CREATE POLICY idempotency_keys_identity ON platform.idempotency_keys
      TO vproject_identity
      USING (
        scope LIKE 'B83:%'
        AND subject_id = NULLIF(current_setting('app.subject_id', true), '')
      )
      WITH CHECK (
        scope LIKE 'B83:%'
        AND subject_id = NULLIF(current_setting('app.subject_id', true), '')
      )$p$;
  END IF;
END
$fix1$;

-- Restore 0021's write rule exactly: a period may be read by its own shop, but only the platform
-- scope may create one. 0022 had widened WITH CHECK to the shop owner for A35's confirmation.
DROP POLICY IF EXISTS subscriptions_tenant ON membership.subscriptions;

CREATE POLICY subscriptions_tenant ON membership.subscriptions
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  )
  WITH CHECK (current_setting('app.is_platform', true) = 'true');

-- 3. AppSec PH-4: column grants cannot separate B35/B36 (staff) from A16 (shop) because both use
--    the app role, so a trigger owns the subject check. SECURITY INVOKER and the pinned search_path
--    keep it honest; it acts only for the app role, and a missing GUC is rejected (fail closed).
CREATE OR REPLACE FUNCTION customers.shopkeepers_guard_self_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, customers, pg_temp
AS $guard$
BEGIN
  -- The migrator, the test owner and any other role keep their existing behaviour.
  IF current_user <> 'vproject_app' THEN
    RETURN NEW;
  END IF;
  -- B35/B36 and the platform scope are the operational writers.
  IF current_setting('app.is_platform', true) = 'true'
     OR current_setting('app.subject_type', true) = 'staff' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'shopkeeper status is not writable in shop context'
      USING ERRCODE = '42501';
  END IF;
  -- A16 may make the one-time choice from NULL, but may never move a chosen shop.
  IF NEW.primary_distributor_id IS DISTINCT FROM OLD.primary_distributor_id
     AND NOT (
       current_setting('app.subject_type', true) = 'shopkeeper'
       AND OLD.primary_distributor_id IS NULL
     ) THEN
    RAISE EXCEPTION 'shopkeeper primary distributor is not writable in shop context'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$guard$;

-- No other role executes the trigger function directly; the trigger itself still fires.
REVOKE ALL ON FUNCTION customers.shopkeepers_guard_self_write() FROM PUBLIC;

DO $fix1owner$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER FUNCTION customers.shopkeepers_guard_self_write() OWNER TO vproject_migrator;
  END IF;
END
$fix1owner$;

CREATE TRIGGER shopkeepers_guard_self_write
  BEFORE UPDATE OF status, primary_distributor_id ON customers.shopkeepers
  FOR EACH ROW
  EXECUTE FUNCTION customers.shopkeepers_guard_self_write();

COMMENT ON FUNCTION customers.shopkeepers_guard_self_write() IS
  'AppSec PH-4: a shop context may set its primary distributor once (from NULL) and may not change status; staff and platform keep B35/B36.';
