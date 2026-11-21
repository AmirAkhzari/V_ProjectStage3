-- A14: the shop's Pro subscription periods. One row per purchased month; the shop's *current* plan is
-- derived (the row with the furthest expiry that is still in the future) rather than stored, so there
-- is no second place that can disagree with the history A14 returns.
--
-- The app role only reads here: A15 (checkout) and its payment confirmation create the rows in a later
-- slice, so this migration grants SELECT and nothing else. A future admin grant (B38) will write with
-- the platform scope, which the policy below already allows.
CREATE TABLE membership.subscriptions (
  id uuid PRIMARY KEY NOT NULL,
  shopkeeper_id uuid NOT NULL REFERENCES customers.shopkeepers(id) ON DELETE CASCADE,
  plan text NOT NULL,
  amount bigint NOT NULL,
  starts_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT subscriptions_plan_check CHECK (plan IN ('pro')),
  CONSTRAINT subscriptions_amount_check CHECK (amount >= 0),
  CONSTRAINT subscriptions_period_check CHECK (expires_at > starts_at)
);

ALTER TABLE membership.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.subscriptions FORCE ROW LEVEL SECURITY;

-- Same row-owner shape as `addresses_tenant`/`shopkeepers_tenant`: a shopkeeper reads only its own
-- periods, the platform scope reads every row, and no app-role write is possible (WITH CHECK is the
-- platform scope only, so even a future INSERT grant could not name another shop — or its own row).
CREATE POLICY subscriptions_tenant ON membership.subscriptions
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  )
  WITH CHECK (current_setting('app.is_platform', true) = 'true');

-- A14 reads one shop's periods newest-expiry-first; this is exactly that access path.
CREATE INDEX subscriptions_shopkeeper_expiry_idx
  ON membership.subscriptions USING btree (shopkeeper_id, expires_at DESC, id DESC);

-- Guarded like 0002/0015/0016/0017/0018/0019: a cluster without the local roles must still migrate.
DO $a14$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT SELECT ON membership.subscriptions TO vproject_app;
  END IF;
END
$a14$;

COMMENT ON TABLE membership.subscriptions IS
  'A14: one Pro period per row; the current plan is derived from the furthest future expires_at.';
