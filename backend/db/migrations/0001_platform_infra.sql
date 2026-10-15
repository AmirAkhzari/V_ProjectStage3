-- Platform infrastructure tables (Architect B-1). Not domain tables.
-- Schemas already exist from 0000; IF NOT EXISTS keeps this replay-safe.
CREATE SCHEMA IF NOT EXISTS "platform";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "catalog";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "customers";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "delivery";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "identity";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "marketing";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "membership";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "notification";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "ordering";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "payment";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "reporting";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "tenancy";
--> statement-breakpoint
CREATE TABLE "platform"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"distributor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "platform"."idempotency_keys" (
	"scope" text NOT NULL,
	"subject_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"status_code" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_subject_key" UNIQUE("scope","subject_id","key")
);
--> statement-breakpoint
CREATE TABLE "platform"."inbox_processed" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_processed_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"distributor_id" uuid,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "platform"."outbox_events" USING btree ("occurred_at") WHERE "platform"."outbox_events"."published_at" IS NULL AND "platform"."outbox_events"."dead_lettered_at" IS NULL;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_worker') THEN
    missing := missing || 'vproject_worker ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    missing := missing || 'vproject_identity ';
  END IF;
  IF missing <> '' AND NOT allow_missing THEN
    RAISE EXCEPTION 'platform infra migration requires roles % (provision them before migrate)', missing;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER TABLE platform.outbox_events OWNER TO vproject_migrator;
    ALTER TABLE platform.inbox_processed OWNER TO vproject_migrator;
    ALTER TABLE platform.audit_log OWNER TO vproject_migrator;
    ALTER TABLE platform.idempotency_keys OWNER TO vproject_migrator;
    ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON SEQUENCES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE vproject_migrator REVOKE ALL ON FUNCTIONS FROM PUBLIC;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO vproject_migrator', current_database());
  END IF;

  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO vproject_app', current_database());
    GRANT USAGE ON SCHEMA platform TO vproject_app;
    GRANT INSERT ON TABLE platform.outbox_events, platform.inbox_processed, platform.audit_log TO vproject_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE platform.idempotency_keys TO vproject_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_worker') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO vproject_worker', current_database());
    GRANT USAGE ON SCHEMA platform TO vproject_worker;
    GRANT SELECT, UPDATE ON TABLE platform.outbox_events, platform.inbox_processed TO vproject_worker;
    GRANT INSERT ON TABLE platform.inbox_processed TO vproject_worker;
    GRANT SELECT, INSERT, UPDATE ON TABLE platform.idempotency_keys TO vproject_worker;
    GRANT SELECT ON TABLE platform.audit_log TO vproject_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_identity') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO vproject_identity', current_database());
  END IF;

  REVOKE ALL ON TABLE platform.outbox_events FROM PUBLIC;
  REVOKE ALL ON TABLE platform.inbox_processed FROM PUBLIC;
  REVOKE ALL ON TABLE platform.audit_log FROM PUBLIC;
  REVOKE ALL ON TABLE platform.idempotency_keys FROM PUBLIC;
END
$grants$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform.outbox_lag_exceeded(max_lag_ms integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.outbox_events
    WHERE published_at IS NULL
      AND dead_lettered_at IS NULL
      AND occurred_at < now() - (max_lag_ms * interval '1 millisecond')
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.outbox_lag_exceeded(integer) FROM PUBLIC;
--> statement-breakpoint
DO $lagfn$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_migrator') THEN
    ALTER FUNCTION platform.outbox_lag_exceeded(integer) OWNER TO vproject_migrator;
  ELSIF current_setting('vproject.allow_missing_roles', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'vproject_migrator is required to own platform.outbox_lag_exceeded';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_app') THEN
    GRANT EXECUTE ON FUNCTION platform.outbox_lag_exceeded(integer) TO vproject_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vproject_worker') THEN
    GRANT EXECUTE ON FUNCTION platform.outbox_lag_exceeded(integer) TO vproject_worker;
  END IF;
END
$lagfn$;

