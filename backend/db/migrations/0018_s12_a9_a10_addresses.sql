-- A9/A10: the shop's own address book. A10 creates one row and makes it the shop's default, A9
-- lists them newest first; A11/A12/A13 (edit / choose default / delete) stay for later slices, so
-- this migration grants SELECT and INSERT only — no UPDATE and no DELETE reach the app role.
--
-- Identity is the row owner, exactly like `shopkeepers_tenant`: a shopkeeper must equal
-- `app.shopkeeper_id`, and the platform scope (existing admin reads) sees every row. Staff policies
-- arrive with the admin address slice, not here.
CREATE TABLE customers.addresses (
  id uuid PRIMARY KEY NOT NULL,
  shopkeeper_id uuid NOT NULL REFERENCES customers.shopkeepers(id) ON DELETE CASCADE,
  title text NOT NULL,
  full_address text NOT NULL,
  plaque text NOT NULL,
  unit text NOT NULL,
  tag text,
  branch_name text,
  city_name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  street_label text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT addresses_tag_check CHECK (tag IS NULL OR tag IN ('store', 'warehouse', 'branch')),
  CONSTRAINT addresses_lat_check CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT addresses_lng_check CHECK (lng BETWEEN -180 AND 180)
);

ALTER TABLE customers.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers.addresses FORCE ROW LEVEL SECURITY;

CREATE POLICY addresses_tenant ON customers.addresses
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  );

-- A9 pages/orders newest first per shop; this is exactly that access path.
CREATE INDEX addresses_shopkeeper_created_idx
  ON customers.addresses USING btree (shopkeeper_id, created_at DESC, id DESC);

-- `defaultAddressId` in A7 is this column. It points at one of the shop's own addresses because the
-- only writer is A10 (server-side); `ON DELETE SET NULL` keeps the pointer honest if a later address
-- deletion slice removes the row.
ALTER TABLE customers.shopkeepers
  ADD COLUMN default_address_id uuid REFERENCES customers.addresses(id) ON DELETE SET NULL;

-- Guarded like 0002/0015/0016/0017: a cluster without the local roles (the health harness) must
-- still migrate. `phone`/`account_id` stay unreachable; this adds one more column to the 0015 grant.
DO $a9$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT SELECT, INSERT ON customers.addresses TO vproject_app;
    GRANT UPDATE (default_address_id) ON customers.shopkeepers TO vproject_app;
  END IF;
END
$a9$;
