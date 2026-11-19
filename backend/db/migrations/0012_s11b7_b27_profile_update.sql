-- B27: a distributor_admin edits the non-financial profile of its own tenant. The new policy is
-- permissive and tenant-scoped, so the platform policy still lets a super_admin update any tenant.
-- The grant is column-level (name only): status and the tenant id stay immutable, and INSERT /
-- DELETE remain denied for vproject_app (TENANT-01-S11B).
CREATE POLICY distributors_update_own ON tenancy.distributors
  FOR UPDATE
  USING (id = NULLIF(current_setting('app.distributor_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.distributor_id', true), '')::uuid);
--> statement-breakpoint
DO $grants$
DECLARE
  allow_missing boolean := current_setting('vproject.allow_missing_roles', true) = 'on';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    IF NOT allow_missing THEN
      RAISE EXCEPTION 'B27 distributor profile migration requires role vproject_app';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT UPDATE (name) ON TABLE tenancy.distributors TO vproject_app;
  END IF;
END
$grants$;
