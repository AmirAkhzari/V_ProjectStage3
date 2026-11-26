-- A36/S3 payments re-entry. Forward-only; 0001-0023 are untouched.
--
-- A36 asks the PSP for a redirect after the checkout transaction has committed, so the intent needs to
-- remember how many attempts it has opened: the contract caps them at 3 (`start_count<=3`) and the
-- counter is the only thing that stops a client from minting gateway sessions forever.
ALTER TABLE payment.payments
  ADD COLUMN start_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT payments_start_count_check CHECK (start_count BETWEEN 0 AND 3);

-- S3 is idempotent on (provider, authority): the callback names one attempt, not one payment, so a
-- replayed notification can only ever settle the row it was issued for.
CREATE UNIQUE INDEX payments_provider_authority_idx
  ON payment.payments USING btree (provider, authority)
  WHERE authority IS NOT NULL;

-- FIX-PR1 containment stays exactly as 0023 left it: the app role holds no INSERT on payments or
-- subscriptions and no UPDATE on the financial columns. Payments re-entry therefore goes through three
-- narrow SECURITY DEFINER functions that re-check the caller's scope themselves:
--   * a shop may open a pending intent for its own shop (A15),
--   * only the platform scope may settle one (S3),
--   and only that settlement may grant a period.
-- The app role gains one updatable column (A36's attempt counter) and EXECUTE on the three functions.
DO $a36grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT UPDATE (start_count) ON payment.payments TO vproject_app;
  END IF;
END
$a36grant$;

CREATE OR REPLACE FUNCTION payment.create_pending_payment(
  p_id uuid,
  p_shopkeeper_id uuid,
  p_amount bigint,
  p_provider text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, payment, pg_temp
AS $create$
DECLARE
  v_id uuid;
BEGIN
  -- The platform scope may open an intent for any shop; a shop scope only for itself. An unset GUC
  -- matches nothing and is rejected, so the check fails closed.
  IF current_setting('app.is_platform', true) IS DISTINCT FROM 'true'
     AND p_shopkeeper_id IS DISTINCT FROM
         NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid THEN
    RAISE EXCEPTION 'payment intent is not creatable in this scope' USING ERRCODE = '42501';
  END IF;
  INSERT INTO payment.payments
         (id, shopkeeper_id, kind, amount, status, provider, idempotency_key, created_at, updated_at)
  VALUES (p_id, p_shopkeeper_id, 'subscription', p_amount, 'pending', p_provider, p_idempotency_key, now(), now())
  ON CONFLICT (shopkeeper_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  -- Lost the race against a concurrent checkout with the same key: that row is the answer.
  IF v_id IS NULL THEN
    v_id := (SELECT p.id
               FROM payment.payments AS p
              WHERE p.shopkeeper_id = p_shopkeeper_id AND p.idempotency_key = p_idempotency_key);
  END IF;
  RETURN v_id;
END
$create$;

CREATE OR REPLACE FUNCTION membership.grant_pro_period(
  p_shopkeeper_id uuid,
  p_amount bigint,
  p_now timestamptz
)
RETURNS TABLE (id uuid, starts_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, membership, pg_temp
AS $period$
DECLARE
  v_id uuid := gen_random_uuid();
  v_starts timestamptz;
BEGIN
  -- The only caller is a payment the provider already verified, in the platform scope S3 opens.
  IF current_setting('app.is_platform', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'a period is only granted by a verified payment' USING ERRCODE = '42501';
  END IF;
  v_starts := (SELECT GREATEST(p_now, COALESCE(max(s.expires_at), p_now))
                 FROM membership.subscriptions AS s
                WHERE s.shopkeeper_id = p_shopkeeper_id AND s.expires_at > p_now);
  INSERT INTO membership.subscriptions
         (id, shopkeeper_id, plan, amount, starts_at, expires_at, created_at)
  VALUES (v_id, p_shopkeeper_id, 'pro', p_amount, v_starts, v_starts + interval '1 month', p_now);
  RETURN QUERY SELECT v_id, v_starts, v_starts + interval '1 month';
END
$period$;

CREATE OR REPLACE FUNCTION payment.settle_pending_payment(p_payment_id uuid, p_paid boolean)
-- `payment_status` rather than `status`: an OUT parameter named like a column makes every reference in
-- the body ambiguous.
RETURNS TABLE (payment_status text, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, payment, pg_temp
AS $settle$
DECLARE
  v_status text;
  v_amount bigint;
  v_shopkeeper_id uuid;
BEGIN
  -- A PSP callback has no session, so this is the one path allowed to settle, and only in platform scope.
  IF current_setting('app.is_platform', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'payment settlement requires the platform scope' USING ERRCODE = '42501';
  END IF;
  IF p_paid THEN
    UPDATE payment.payments
       SET status = 'paid', paid_at = now(), updated_at = now()
     WHERE id = p_payment_id AND status = 'pending'
     RETURNING amount, shopkeeper_id INTO v_amount, v_shopkeeper_id;
    IF v_amount IS NOT NULL THEN
      PERFORM membership.grant_pro_period(v_shopkeeper_id, v_amount, now());
      RETURN QUERY SELECT 'paid'::text, true;
      RETURN;
    END IF;
  ELSE
    UPDATE payment.payments
       SET status = 'failed', updated_at = now()
     WHERE id = p_payment_id AND status = 'pending'
     RETURNING amount INTO v_amount;
    IF v_amount IS NOT NULL THEN
      RETURN QUERY SELECT 'failed'::text, true;
      RETURN;
    END IF;
  END IF;
  -- Already settled (a replay) or no such row: the stored verdict is the answer.
  RETURN QUERY SELECT p.status, false
                 FROM payment.payments AS p
                WHERE p.id = p_payment_id;
END
$settle$;

-- The functions stay owned by the migration role (the schema owner), which is what lets SECURITY
-- DEFINER reach the tables while 0023 keeps the app role out; each function re-checks the scope GUCs
-- before touching a row, so ownership is not the authorisation.
REVOKE ALL ON FUNCTION payment.create_pending_payment(uuid, uuid, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION membership.grant_pro_period(uuid, bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment.settle_pending_payment(uuid, boolean) FROM PUBLIC;

DO $a36execute$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT EXECUTE ON FUNCTION payment.create_pending_payment(uuid, uuid, bigint, text, text)
      TO vproject_app;
    GRANT EXECUTE ON FUNCTION membership.grant_pro_period(uuid, bigint, timestamptz)
      TO vproject_app;
    GRANT EXECUTE ON FUNCTION payment.settle_pending_payment(uuid, boolean) TO vproject_app;
  END IF;
END
$a36execute$;

COMMENT ON COLUMN payment.payments.start_count IS
  'A36: redirect requests issued for this intent; at most 3 (contract: start_count<=3).';
COMMENT ON FUNCTION payment.create_pending_payment(uuid, uuid, bigint, text, text) IS
  'A15: opens (or returns) one pending intent; the app role has no INSERT on payment.payments.';
COMMENT ON FUNCTION membership.grant_pro_period(uuid, bigint, timestamptz) IS
  'S3: the single statement that mints a Pro period, extending a live plan instead of resetting it.';
COMMENT ON FUNCTION payment.settle_pending_payment(uuid, boolean) IS
  'S3: settles one pending payment in platform scope and grants its period exactly once.';
