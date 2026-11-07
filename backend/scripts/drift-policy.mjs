/** Architect B-1 / R2-5 + S11b-1: platform infra and named S-11b tables only. */
export const SCHEMAS = [
  'identity',
  'tenancy',
  'customers',
  'catalog',
  'ordering',
  'delivery',
  'payment',
  'membership',
  'marketing',
  'notification',
  'reporting',
  'platform',
];

export const ALLOWED_TABLES = new Set([
  'platform.outbox_events',
  'platform.inbox_processed',
  'platform.audit_log',
  'platform.idempotency_keys',
  'identity.accounts',
  'identity.driver_credentials',
  'identity.staff_memberships',
  'identity.sessions',
  'identity.refresh_tokens',
  'identity.pending_session_denies',
  'identity.otp_challenges',
  'tenancy.distributors',
  'customers.shopkeepers',
]);

const TABLE_KIND = '(?:(?:GLOBAL|LOCAL)\\s+)?(?:TEMP(?:ORARY)?\\s+|UNLOGGED\\s+)?';
const QUALIFIED_TABLE = '(?:"?([a-zA-Z_]+)"?\\.)?"?([a-zA-Z_]+)"?';

const CREATE_TABLE_RE = new RegExp(
  `CREATE\\s+${TABLE_KIND}TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED_TABLE}`,
  'gi',
);

const FORBIDDEN_SQL = [
  { re: /\b(?:numeric|decimal|money)\b/i, msg: 'non-BIGINT money type' },
  { re: /\btimestamp\s+without\s+time\s+zone\b/i, msg: 'timestamp without time zone' },
  {
    re: /CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?|UNLOGGED)\s+TABLE\b/i,
    msg: 'CREATE TEMP/UNLOGGED TABLE',
  },
  { re: /\bPARTITION\s+OF\b/i, msg: 'CREATE TABLE ... PARTITION OF' },
  {
    re: /CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\b[^;]*\bAS\s+(?:WITH|SELECT|TABLE|VALUES)\b/i,
    msg: 'CREATE TABLE AS',
  },
  {
    re: /\bSELECT\b[^;]*\bINTO\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+|TABLE\s+)?/i,
    msg: 'SELECT INTO',
  },
];

export function checkMigrationSql(combined) {
  const errors = [];

  for (const schema of SCHEMAS) {
    const pattern = new RegExp(`CREATE SCHEMA IF NOT EXISTS ["']?${schema}["']?\\b`, 'i');
    if (!pattern.test(combined)) {
      errors.push(`missing CREATE SCHEMA for ${schema}`);
    }
  }

  for (const match of combined.matchAll(CREATE_TABLE_RE)) {
    const schema = match[1] ?? 'public';
    const qualified = `${schema}.${match[2]}`;
    if (!ALLOWED_TABLES.has(qualified)) {
      errors.push(
        `forbidden CREATE TABLE ${qualified}; only ${[...ALLOWED_TABLES].join(', ')} allowed`,
      );
    }
  }

  for (const rule of FORBIDDEN_SQL) {
    if (rule.re.test(combined)) errors.push(`forbidden SQL: ${rule.msg}`);
  }

  return errors;
}
