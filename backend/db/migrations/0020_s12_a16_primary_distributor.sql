-- A16: a shop chooses the distributor it buys from. The write itself needs nothing new: 0016 already
-- granted the app role `UPDATE (primary_distributor_id)` on customers.shopkeepers, and
-- `shopkeepers_tenant` (0002, FORCE RLS with both USING and WITH CHECK) already admits an UPDATE only
-- on the caller's own row — so a shop can neither edit another shop nor move its own row's owner.
--
-- What was missing is a way to *name* a distributor. `distributors_select` keys on
-- `app.distributor_id`, which a shopkeeper session never sets (tenantPrincipal only sets
-- `app.shopkeeper_id`), so the app role could not see a single row of `tenancy.distributors` and every
-- id would look like a missing one. This adds the shopkeeper read scope, limited to active
-- distributors: exactly the rows A16 accepts and the rows A17's picker will list. Policies are
-- permissive and OR-ed, so the staff/platform visibility from 0002 is unchanged.
CREATE POLICY distributors_shopkeeper_read ON tenancy.distributors
  FOR SELECT
  USING (
    status = 'active'
    AND NULLIF(current_setting('app.shopkeeper_id', true), '') IS NOT NULL
  );
