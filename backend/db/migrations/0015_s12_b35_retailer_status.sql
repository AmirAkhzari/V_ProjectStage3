-- B35: block/unblock. A staff token may flip the status of the shops its own distributor supplies,
-- and the platform scope any shop. `shopkeepers_tenant` (0002) still governs a shopkeeper's own row,
-- and `shopkeepers_staff_read` (0014) stays read-only, so this policy only adds the staff branch.
CREATE POLICY shopkeepers_staff_update ON customers.shopkeepers
  FOR UPDATE
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR (
      current_setting('app.subject_type', true) = 'staff'
      AND primary_distributor_id IS NOT NULL
      AND primary_distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR (
      current_setting('app.subject_type', true) = 'staff'
      AND primary_distributor_id IS NOT NULL
      AND primary_distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
    )
  );

-- The table-level UPDATE grant from 0002 would let the app role rewrite `phone`, `account_id` or
-- `primary_distributor_id` on any row its policy admits. B35 needs exactly one column, so the write
-- surface is narrowed to `status` (the same shape 0012 used for the B27 profile name).
-- Guarded like 0002: a cluster without the local roles (the health harness) must still migrate.
DO $b35$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    REVOKE UPDATE ON customers.shopkeepers FROM vproject_app;
    GRANT UPDATE (status) ON customers.shopkeepers TO vproject_app;
  END IF;
END
$b35$;
