-- P0-E4-T2: one empty schema per canonical module + platform. No domain tables.
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS tenancy;
CREATE SCHEMA IF NOT EXISTS customers;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS ordering;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS membership;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS platform;

GRANT USAGE ON SCHEMA identity TO vproject_identity;
GRANT USAGE ON SCHEMA tenancy, customers, catalog, ordering, delivery, payment, membership, marketing, notification, reporting, platform TO vproject_app;
GRANT USAGE ON SCHEMA tenancy, customers, catalog, ordering, delivery, payment, membership, marketing, notification, reporting, platform TO vproject_worker;

ALTER SCHEMA identity OWNER TO vproject_migrator;
ALTER SCHEMA tenancy OWNER TO vproject_migrator;
ALTER SCHEMA customers OWNER TO vproject_migrator;
ALTER SCHEMA catalog OWNER TO vproject_migrator;
ALTER SCHEMA ordering OWNER TO vproject_migrator;
ALTER SCHEMA delivery OWNER TO vproject_migrator;
ALTER SCHEMA payment OWNER TO vproject_migrator;
ALTER SCHEMA membership OWNER TO vproject_migrator;
ALTER SCHEMA marketing OWNER TO vproject_migrator;
ALTER SCHEMA notification OWNER TO vproject_migrator;
ALTER SCHEMA reporting OWNER TO vproject_migrator;
ALTER SCHEMA platform OWNER TO vproject_migrator;
