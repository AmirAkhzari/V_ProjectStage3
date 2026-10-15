CREATE TABLE "customers"."shopkeepers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"primary_distributor_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shopkeepers_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"typ" text NOT NULL,
	"phone" text,
	"username_norm" text,
	"status" text NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_phone_unique" UNIQUE("phone"),
	CONSTRAINT "accounts_username_norm_unique" UNIQUE("username_norm"),
	CONSTRAINT "accounts_username_norm_check" CHECK ("username_norm" = lower("username_norm") AND length("username_norm") <= 64)
);
--> statement-breakpoint
CREATE TABLE "identity"."driver_credentials" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"distributor_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"temp_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."refresh_tokens" (
	"hash" text PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"sid" uuid NOT NULL,
	"rotated_at" timestamp with time zone,
	"successor" text
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"sid" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"typ" text NOT NULL,
	"family_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "identity"."staff_memberships" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"distributor_id" uuid,
	"permissions" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."distributors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."driver_credentials" ADD CONSTRAINT "driver_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_sid_sessions_sid_fk" FOREIGN KEY ("sid") REFERENCES "identity"."sessions"("sid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."staff_memberships" ADD CONSTRAINT "staff_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "identity"."refresh_tokens" USING btree ("family_id");
--> statement-breakpoint
CREATE INDEX "refresh_tokens_sid_idx" ON "identity"."refresh_tokens" USING btree ("sid");
--> statement-breakpoint
CREATE INDEX "sessions_account_id_idx" ON "identity"."sessions" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "sessions_family_id_idx" ON "identity"."sessions" USING btree ("family_id");
--> statement-breakpoint
COMMENT ON COLUMN identity.refresh_tokens.successor IS 'Hash of the successor refresh token; never store plaintext.';
--> statement-breakpoint
ALTER TABLE identity.accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_identity ON identity.accounts
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE identity.sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_identity ON identity.sessions
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE identity.refresh_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.refresh_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY refresh_tokens_identity ON identity.refresh_tokens
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE identity.driver_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.driver_credentials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY driver_credentials_tenant ON identity.driver_credentials
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE identity.staff_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE identity.staff_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_memberships_tenant ON identity.staff_memberships
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR distributor_id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE tenancy.distributors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.distributors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY distributors_select ON tenancy.distributors
  FOR SELECT
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR id = NULLIF(current_setting('app.distributor_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY distributors_write ON tenancy.distributors
  FOR INSERT
  WITH CHECK (current_setting('app.is_platform', true) = 'true');
--> statement-breakpoint
CREATE POLICY distributors_update ON tenancy.distributors
  FOR UPDATE
  USING (current_setting('app.is_platform', true) = 'true')
  WITH CHECK (current_setting('app.is_platform', true) = 'true');
--> statement-breakpoint
ALTER TABLE customers.shopkeepers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customers.shopkeepers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shopkeepers_tenant ON customers.shopkeepers
  USING (
    current_setting('app.is_platform', true) = 'true'
    OR id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.is_platform', true) = 'true'
    OR id = NULLIF(current_setting('app.shopkeeper_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION identity.lookup_driver_login(p_username_norm text)
RETURNS TABLE (
  account_id uuid,
  distributor_id uuid,
  password_hash text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = identity, pg_temp
AS $$
  SELECT a.id, dc.distributor_id, dc.password_hash, a.status
  FROM identity.accounts a
  INNER JOIN identity.driver_credentials dc ON dc.account_id = a.id
  WHERE a.username_norm = p_username_norm
    AND a.typ = 'driver';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.lookup_driver_login(text) FROM PUBLIC;
--> statement-breakpoint
DO $grants$
DECLARE
  allow_missing boolean := current_setting('vproject.allow_missing_roles', true) = 'on';
  missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    missing := missing || 'vproject_migrator ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    missing := missing || 'vproject_app ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    missing := missing || 'vproject_identity ';
  END IF;
  IF missing <> '' AND NOT allow_missing THEN
    RAISE EXCEPTION 'S-11b identity tables migration requires roles % (provision them before migrate)', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER TABLE identity.accounts OWNER TO vproject_migrator;
    ALTER TABLE identity.driver_credentials OWNER TO vproject_migrator;
    ALTER TABLE identity.staff_memberships OWNER TO vproject_migrator;
    ALTER TABLE identity.sessions OWNER TO vproject_migrator;
    ALTER TABLE identity.refresh_tokens OWNER TO vproject_migrator;
    ALTER TABLE tenancy.distributors OWNER TO vproject_migrator;
    ALTER TABLE customers.shopkeepers OWNER TO vproject_migrator;
    ALTER FUNCTION identity.lookup_driver_login(text) OWNER TO vproject_migrator;
    CREATE POLICY driver_credentials_login_lookup ON identity.driver_credentials
      FOR SELECT TO vproject_migrator
      USING (true);
    CREATE POLICY accounts_login_lookup ON identity.accounts
      FOR SELECT TO vproject_migrator
      USING (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    GRANT USAGE ON SCHEMA identity TO vproject_identity;
    GRANT SELECT, INSERT, UPDATE ON TABLE
      identity.accounts,
      identity.driver_credentials,
      identity.staff_memberships,
      identity.sessions,
      identity.refresh_tokens
      TO vproject_identity;
    GRANT USAGE ON SCHEMA platform TO vproject_identity;
    GRANT INSERT ON TABLE platform.audit_log, platform.outbox_events TO vproject_identity;
    GRANT EXECUTE ON FUNCTION identity.lookup_driver_login(text) TO vproject_identity;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT USAGE ON SCHEMA tenancy, customers TO vproject_app;
    GRANT SELECT ON TABLE tenancy.distributors TO vproject_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE customers.shopkeepers TO vproject_app;
  END IF;

  REVOKE ALL ON TABLE identity.accounts FROM PUBLIC;
  REVOKE ALL ON TABLE identity.driver_credentials FROM PUBLIC;
  REVOKE ALL ON TABLE identity.staff_memberships FROM PUBLIC;
  REVOKE ALL ON TABLE identity.sessions FROM PUBLIC;
  REVOKE ALL ON TABLE identity.refresh_tokens FROM PUBLIC;
  REVOKE ALL ON TABLE tenancy.distributors FROM PUBLIC;
  REVOKE ALL ON TABLE customers.shopkeepers FROM PUBLIC;
END
$grants$;
