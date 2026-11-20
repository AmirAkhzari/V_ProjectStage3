-- A11/A12/A13: edit, choose the default and delete one of the shop's own addresses. A11 rewrites
-- the address fields, A12 moves `shopkeepers.default_address_id` (already granted by 0018) and A13
-- is a *soft* delete, exactly as the contract calls it, so the app role still gets no DELETE: the
-- row keeps existing and only `deleted_at` marks it gone. `id`, `shopkeeper_id` and `created_at`
-- stay unwritable, so an address can never change owner or age.
--
-- `addresses_tenant` (0018) already covers UPDATE: it is FORCE RLS with both `USING` and
-- `WITH CHECK`, so the write sees only the shop's own rows and cannot move one to another shop.
-- This migration therefore widens the grant, never the policy.
ALTER TABLE customers.addresses ADD COLUMN deleted_at timestamp with time zone;

-- Live rows are the only ones A9/A11/A12/A13 ever answer; the platform scope reads the same way.
-- The existing `addresses_shopkeeper_created_idx` still serves the order, so no second index.
--
-- Guarded like 0002/0015/0016/0017/0018: a cluster without the local roles (the health harness)
-- must still migrate.
DO $a11$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT UPDATE (title, full_address, plaque, unit, tag, branch_name, city_name,
                  lat, lng, street_label, deleted_at)
      ON customers.addresses TO vproject_app;
  END IF;
END
$a11$;
