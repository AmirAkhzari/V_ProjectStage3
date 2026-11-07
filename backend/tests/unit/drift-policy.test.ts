import { describe, expect, it } from 'vitest';
import { ALLOWED_TABLES, checkMigrationSql } from '../../scripts/drift-policy.mjs';

const SCHEMAS_SQL = [
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
]
  .map((s) => `CREATE SCHEMA IF NOT EXISTS ${s};`)
  .join('\n');

const ALLOWED_SQL = [...ALLOWED_TABLES]
  .map((name) => {
    const [schema, table] = name.split('.');
    return `CREATE TABLE "${schema}"."${table}" (id uuid);`;
  })
  .join('\n');

const BASE = `${SCHEMAS_SQL}\n${ALLOWED_SQL}`;

describe('checkMigrationSql', () => {
  it('accepts the allow-listed platform and S-11b tables', () => {
    expect(checkMigrationSql(BASE)).toEqual([]);
    expect(ALLOWED_TABLES.has('identity.accounts')).toBe(true);
    expect(ALLOWED_TABLES.has('identity.pending_session_denies')).toBe(true);
    expect(ALLOWED_TABLES.has('tenancy.distributors')).toBe(true);
    expect(ALLOWED_TABLES.has('customers.shopkeepers')).toBe(true);
    expect(ALLOWED_TABLES.has('identity.otp_challenges')).toBe(true);
    expect(ALLOWED_TABLES.size).toBe(13);
  });

  it('rejects a domain CREATE TABLE', () => {
    expect(checkMigrationSql(`${BASE}\nCREATE TABLE catalog.products (id uuid);`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/forbidden CREATE TABLE catalog.products/)]),
    );
  });

  it('rejects CREATE UNLOGGED and TEMP TABLE', () => {
    expect(checkMigrationSql(`${BASE}\nCREATE UNLOGGED TABLE catalog.cache (id uuid);`)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/UNLOGGED/),
        expect.stringMatching(/forbidden CREATE TABLE catalog.cache/),
      ]),
    );
    expect(checkMigrationSql(`${BASE}\nCREATE TEMP TABLE scratch (id uuid);`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/TEMP/)]),
    );
  });

  it('rejects PARTITION OF, CTAS, and SELECT INTO', () => {
    expect(
      checkMigrationSql(
        `${BASE}\nCREATE TABLE catalog.p PARTITION OF catalog.products FOR VALUES FROM (1) TO (2);`,
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/PARTITION OF/)]));
    expect(
      checkMigrationSql(`${BASE}\nCREATE TABLE catalog.copied AS SELECT * FROM catalog.products;`),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/CREATE TABLE AS/)]));
    expect(
      checkMigrationSql(`${BASE}\nSELECT * INTO catalog.copied FROM catalog.products;`),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/SELECT INTO/)]));
  });
});
