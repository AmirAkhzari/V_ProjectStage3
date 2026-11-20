-- B36: a shop's primary distributor becomes settable on the same UPDATE policy 0015 introduced
-- (`shopkeepers_staff_update`: the caller's own distributor, or the platform scope), so the app role
-- needs that column on top of the status-only grant. PostgreSQL keeps table-level and column-level
-- grants apart, so this adds one column instead of replacing the 0015 grant. `phone` and `account_id`
-- stay unreachable from the app role.
-- Guarded like 0002/0015: a cluster without the local roles (the health harness) must still migrate.
DO $b36$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT UPDATE (primary_distributor_id) ON customers.shopkeepers TO vproject_app;
  END IF;
END
$b36$;
