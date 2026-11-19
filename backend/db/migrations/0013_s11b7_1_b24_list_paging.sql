-- B24: the tenant list pages on the frozen key order (name, id). This index is exactly that
-- keyset, so a SuperAdmin switcher walks tenants page by page without a full sort. No grant
-- changes: vproject_app already holds SELECT on the table from 0002.
CREATE INDEX distributors_name_id_idx ON tenancy.distributors USING btree (name, id);
