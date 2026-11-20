-- A8: a shopkeeper edits its own display name. Until now `customers.shopkeepers` had no name
-- column at all, which is why A7 answered `user.name = null` and B33/B34 had no name to show.
-- The column is nullable: existing rows stay null (the clients render the phone instead) until the
-- shop saves a name, so no backfill invents data.
ALTER TABLE customers.shopkeepers ADD COLUMN name text;

-- `shopkeepers_tenant` (0002) already admits a shopkeeper's own row for UPDATE, and 0015 revoked the
-- table-level UPDATE, so the app role needs exactly this one more column. `status` (0015) and
-- `primary_distributor_id` (0016) keep their grants; `phone` and `account_id` stay unreachable.
-- Guarded like 0002/0015/0016: a cluster without the local roles (the health harness) must migrate.
DO $a8$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT UPDATE (name) ON customers.shopkeepers TO vproject_app;
  END IF;
END
$a8$;
