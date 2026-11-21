-- A15: payment intents for the Pro subscription. One row per checkout attempt, and the period is only
-- created when A35 (mock PSP) confirms the payment — nothing here mints a plan on its own.
--
-- `idempotency_key` is stored on the row rather than in `platform.idempotency_keys` because the replay
-- A15 promises is "same key ⇒ same payment", not "same key ⇒ same HTTP body": the row *is* the stored
-- response, so a replay cannot drift from the payment it describes, and the unique index below settles
-- two concurrent checkouts without a second lock. The key format (16..128) is the contract's own.
CREATE TABLE payment.payments (
  id uuid PRIMARY KEY NOT NULL,
  shopkeeper_id uuid NOT NULL REFERENCES customers.shopkeepers(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount bigint NOT NULL,
  status text NOT NULL,
  provider text NOT NULL,
  idempotency_key text NOT NULL,
  authority text,
  redirect_url text,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  CONSTRAINT payments_kind_check CHECK (kind IN ('subscription')),
  CONSTRAINT payments_amount_check CHECK (amount >= 0),
  CONSTRAINT payments_status_check CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  CONSTRAINT payments_idempotency_key_length_check CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  CONSTRAINT payments_paid_at_check CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

-- A15's replay path: one payment per (shop, key), and the conflict target of its insert.
CREATE UNIQUE INDEX payments_shopkeeper_idempotency_idx
  ON payment.payments USING btree (shopkeeper_id, idempotency_key);

-- A34 reads one payment by id under RLS; this is the owner's list path for later wallet/order slices.
CREATE INDEX payments_shopkeeper_created_idx
  ON payment.payments USING btree (shopkeeper_id, created_at DESC, id DESC);

ALTER TABLE payment.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment.payments FORCE ROW LEVEL SECURITY;

-- Same row-owner shape as `subscriptions_tenant`: a shop reads and completes only its own payments, so
-- an id belonging to another shop is the uniform 404 and never a 403. A35 is the only writer today and
-- it only flips its own pending row, hence INSERT/UPDATE without DELETE.
CREATE POLICY payments_tenant ON payment.payments
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  );

-- A35 creates the subscription period when a payment is confirmed, so the app role now inserts its own
-- periods. 0021 deliberately allowed only SELECT; that was right while no confirmation existed. The
-- ownership check stays: a period can only be named for the shop in `app.shopkeeper_id`, and the only
-- code that writes here derives the shop from the locked payment row, never from the request.
DROP POLICY subscriptions_tenant ON membership.subscriptions;

CREATE POLICY subscriptions_tenant ON membership.subscriptions
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR shopkeeper_id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  );

-- Guarded like 0002/0015/0016/0017/0018/0019/0021: a cluster without the local roles must still migrate.
DO $a15$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT SELECT, INSERT, UPDATE ON payment.payments TO vproject_app;
    GRANT INSERT ON membership.subscriptions TO vproject_app;
  END IF;
END
$a15$;

COMMENT ON TABLE payment.payments IS
  'A15: one payment intent per checkout attempt; A35 confirms it and creates the Pro period.';
