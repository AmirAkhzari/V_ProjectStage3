-- Applied after CREATE SCHEMA, only with local roles (AppSec H-1). Not a drizzle migration.
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
