-- B33: the admin retailer list pages newest first on the frozen key order (created_at, id).
-- This index is exactly that keyset, so a page never sorts the whole table.
CREATE INDEX shopkeepers_created_at_id_idx ON customers.shopkeepers USING btree (created_at DESC, id DESC);

-- B33: `shopkeepers_tenant` (0002) only admits the platform scope or the shopkeeper itself, so a
-- distributor admin cannot read the shops it supplies. Staff reads were deferred with DL-18; this
-- policy adds exactly the visibility the admin panel already assumes: a staff member in one tenant
-- sees the shopkeepers whose primary distributor is that tenant. The shopkeeper branch of the old
-- policy still governs app tokens (they carry no `app.distributor_id`), and drivers are excluded by
-- requiring `app.subject_type = 'staff'`, so the widening never reaches a non-staff token.
CREATE POLICY shopkeepers_staff_read ON customers.shopkeepers
  FOR SELECT
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR (
      current_setting('app.subject_type', true) = 'staff'
      AND primary_distributor_id IS NOT NULL
      AND primary_distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
    )
  );
