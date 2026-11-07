import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  EXAMPLE_AUDIT_HASH_KEY,
  PROD_FIXTURE_AUDIT_HASH_KEY,
  PROD_FIXTURE_KAVENEGAR_API_KEY,
  PROD_LIVE_FIXTURE_KAVENEGAR_API_KEY,
  PROD_FIXTURE_KAVENEGAR_TEMPLATE,
  PROD_FIXTURE_OTP_HMAC_KEY,
  TEST_AUDIT_HASH_KEY,
  loadApiConfig,
  loadConfig,
  loadWorkerConfig,
} from './config.js';

const validApi = {
  NODE_ENV: 'test',
  DATABASE_URL_APP: 'postgres://vproject_app:vproject@127.0.0.1:5432/vproject',
  DATABASE_URL_IDENTITY: 'postgres://vproject_identity:vproject@127.0.0.1:5432/vproject',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

const validApiProduction = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://vproject_app:vproject@db.example.ir:5432/vproject?sslmode=require',
  DATABASE_URL_IDENTITY:
    'postgres://vproject_identity:vproject@db.example.ir:5432/vproject?sslmode=require',
  REDIS_URL: 'rediss://cache.example.ir:6379',
  LOG_LEVEL: 'info',
  OPENAPI_DOCS_ENABLED: 'false',
  TRUST_PROXY_HOPS: '1',
  AUDIT_HASH_KEY: PROD_FIXTURE_AUDIT_HASH_KEY,
  SMS_PROVIDER: 'kavenegar',
  SMS_LIVE_SEND: 'true',
  SMS_BUDGET_HOUR: '100',
  SMS_BUDGET_DAY: '1000',
  KAVENEGAR_API_KEY: PROD_LIVE_FIXTURE_KAVENEGAR_API_KEY,
  KAVENEGAR_TEMPLATE: PROD_FIXTURE_KAVENEGAR_TEMPLATE,
  OTP_HMAC_KEY: PROD_FIXTURE_OTP_HMAC_KEY,
};

const validWorkerProduction = {
  NODE_ENV: 'production',
  DATABASE_URL_WORKER:
    'postgres://vproject_worker:vproject@db.example.ir:5432/vproject?sslmode=require',
  REDIS_URL: 'rediss://cache.example.ir:6379',
  LOG_LEVEL: 'info',
  OPENAPI_DOCS_ENABLED: 'false',
  TRUST_PROXY_HOPS: '1',
};

describe('loadApiConfig', () => {
  it('loads a complete API environment', () => {
    const config = loadConfig(validApi);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL_APP).toMatch(/vproject_app/);
    expect(config.OPENAPI_DOCS_ENABLED).toBe(false);
    expect(config.SESSION_TTL_SHOPKEEPER_SLIDING_DAYS).toBe(30);
    expect(config.SESSION_TTL_SHOPKEEPER_ABSOLUTE_DAYS).toBe(90);
    expect(config.SESSION_TTL_STAFF_ABSOLUTE_DAYS).toBe(7);
    expect(config.SESSION_TTL_STAFF_IDLE_HOURS).toBe(12);
    expect(config.SESSION_TTL_DRIVER_ABSOLUTE_HOURS).toBe(10);
    expect(config.TRUST_PROXY_HOPS).toBe(0);
    expect(config.AUDIT_HASH_KEY).toBe(TEST_AUDIT_HASH_KEY);
    expect(config.SMS_PROVIDER).toBe('fake');
    expect(config.SMS_TIMEOUT_MS).toBe(4000);
    expect(loadApiConfig({ ...validApi, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
  });

  it('R13-3: production requires TRUST_PROXY_HOPS to be set; hops=0 is valid when explicit', () => {
    const { TRUST_PROXY_HOPS: _omit, ...withoutHops } = validApiProduction;
    expect(() => loadApiConfig(withoutHops)).toThrow(ConfigError);
    expect(loadApiConfig({ ...validApiProduction, TRUST_PROXY_HOPS: '0' }).TRUST_PROXY_HOPS).toBe(
      0,
    );
  });

  it('R13-2: production requires AUDIT_HASH_KEY', () => {
    const { AUDIT_HASH_KEY: _omit, ...withoutKey } = validApiProduction;
    expect(() => loadApiConfig(withoutKey)).toThrow(ConfigError);
  });

  it('N14-1 / N13-1: production rejects known and short AUDIT_HASH_KEY', () => {
    expect(() =>
      loadApiConfig({ ...validApiProduction, AUDIT_HASH_KEY: TEST_AUDIT_HASH_KEY }),
    ).toThrow(/AUDIT_HASH_KEY/);
    expect(() =>
      loadApiConfig({ ...validApiProduction, AUDIT_HASH_KEY: EXAMPLE_AUDIT_HASH_KEY }),
    ).toThrow(/AUDIT_HASH_KEY/);
    expect(() => loadApiConfig({ ...validApiProduction, AUDIT_HASH_KEY: 'too-short' })).toThrow(
      ConfigError,
    );
    expect(loadApiConfig(validApiProduction).AUDIT_HASH_KEY).toBe(PROD_FIXTURE_AUDIT_HASH_KEY);
  });

  it('11-13: rejects session TTL values above the policy caps', () => {
    expect(() => loadApiConfig({ ...validApi, SESSION_TTL_SHOPKEEPER_SLIDING_DAYS: '31' })).toThrow(
      ConfigError,
    );
    expect(() => loadApiConfig({ ...validApi, SESSION_TTL_STAFF_ABSOLUTE_DAYS: '8' })).toThrow(
      ConfigError,
    );
    expect(() => loadApiConfig({ ...validApi, SESSION_TTL_DRIVER_ABSOLUTE_HOURS: '11' })).toThrow(
      ConfigError,
    );
  });

  it('requires app and identity URLs, not worker or migrator', () => {
    expect(() => loadApiConfig(validApi)).not.toThrow();
    const issues = (() => {
      try {
        loadApiConfig({ NODE_ENV: 'test' });
        return [];
      } catch (error) {
        return (error as ConfigError).issues.map((i) => i.field);
      }
    })();
    expect(issues).toContain('DATABASE_URL_APP');
    expect(issues).toContain('DATABASE_URL_IDENTITY');
    expect(issues).toContain('REDIS_URL');
    expect(issues).not.toContain('DATABASE_URL_WORKER');
    expect(issues).not.toContain('MIGRATION_DATABASE_URL');
  });

  it('rejects a non-postgres database url', () => {
    expect(() => loadApiConfig({ ...validApi, DATABASE_URL_APP: 'mysql://localhost/db' })).toThrow(
      ConfigError,
    );
  });

  it('accepts production with TLS and docs disabled', () => {
    const config = loadApiConfig(validApiProduction);
    expect(config.NODE_ENV).toBe('production');
  });

  it('rejects OpenAPI docs in production', () => {
    expect(() => loadApiConfig({ ...validApiProduction, OPENAPI_DOCS_ENABLED: 'true' })).toThrow(
      ConfigError,
    );
  });

  it('rejects debug/trace log levels in production', () => {
    expect(() => loadApiConfig({ ...validApiProduction, LOG_LEVEL: 'debug' })).toThrow(ConfigError);
    expect(() => loadApiConfig({ ...validApiProduction, LOG_LEVEL: 'trace' })).toThrow(ConfigError);
  });

  it('rejects DEMO_* flags in production', () => {
    expect(() => loadApiConfig({ ...validApiProduction, DEMO_LOGIN_ENABLED: 'true' })).toThrow(
      ConfigError,
    );
  });

  it('rejects MOCK_* flags in production', () => {
    expect(() => loadApiConfig({ ...validApiProduction, MOCK_SMS: 'true' })).toThrow(ConfigError);
  });

  it('rejects *_PROVIDER=mock in production', () => {
    expect(() => loadApiConfig({ ...validApiProduction, PAYMENT_PROVIDER: 'mock' })).toThrow(
      ConfigError,
    );
  });

  it('S11b-5: production refuses fake SMS and requires kavenegar key+template', () => {
    expect(() => loadApiConfig({ ...validApiProduction, SMS_PROVIDER: 'fake' })).toThrow(
      /SMS_PROVIDER/,
    );
    const {
      SMS_PROVIDER: _provider,
      KAVENEGAR_API_KEY: _key,
      KAVENEGAR_TEMPLATE: _template,
      ...omitted
    } = validApiProduction;
    expect(() => loadApiConfig(omitted)).toThrow(/SMS_PROVIDER/);
    expect(() => loadApiConfig({ ...validApiProduction, KAVENEGAR_API_KEY: undefined })).toThrow(
      /KAVENEGAR_API_KEY/,
    );
    expect(() => loadApiConfig({ ...validApiProduction, KAVENEGAR_TEMPLATE: undefined })).toThrow(
      /KAVENEGAR_TEMPLATE/,
    );
    expect(loadApiConfig(validApiProduction).SMS_PROVIDER).toBe('kavenegar');
    expect(loadApiConfig(validApiProduction).SMS_LIVE_SEND).toBe(true);
    expect(() =>
      loadApiConfig({ ...validApiProduction, KAVENEGAR_API_KEY: PROD_FIXTURE_KAVENEGAR_API_KEY }),
    ).toThrow(/placeholder/);
    expect(() => loadApiConfig({ ...validApiProduction, SMS_LIVE_SEND: 'false' })).toThrow(
      /SMS_LIVE_SEND/,
    );
    expect(
      loadApiConfig({
        ...validApiProduction,
        SMS_LIVE_SEND: 'false',
        SMS_STAGING_ALLOW_DISABLED: 'true',
      }).SMS_LIVE_SEND,
    ).toBe(false);
    const { SMS_BUDGET_HOUR: _h, SMS_BUDGET_DAY: _d, ...noBudget } = validApiProduction;
    expect(() => loadApiConfig(noBudget)).toThrow(/SMS_BUDGET/);
  });

  it('rejects Postgres URLs without TLS in production', () => {
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        DATABASE_URL_APP: 'postgres://vproject_app:vproject@db.example.ir:5432/vproject',
      }),
    ).toThrow(ConfigError);
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        DATABASE_URL_IDENTITY: 'postgres://vproject_identity:vproject@db.example.ir:5432/vproject',
      }),
    ).toThrow(ConfigError);
  });

  it('rejects Redis URLs without TLS in production', () => {
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        REDIS_URL: 'redis://cache.example.ir:6379',
      }),
    ).toThrow(ConfigError);
  });

  it('forbids MIGRATION_DATABASE_URL on the API in production', () => {
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        MIGRATION_DATABASE_URL:
          'postgres://vproject_migrator:vproject@db.example.ir:5432/vproject?sslmode=require',
      }),
    ).toThrow(ConfigError);
    try {
      loadApiConfig({
        ...validApiProduction,
        MIGRATION_DATABASE_URL:
          'postgres://vproject_migrator:vproject@db.example.ir:5432/vproject?sslmode=require',
      });
    } catch (error) {
      expect((error as ConfigError).issues.some((i) => i.field === 'MIGRATION_DATABASE_URL')).toBe(
        true,
      );
    }
  });

  it('forbids worker and owner URLs on the API in production', () => {
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        DATABASE_URL_WORKER:
          'postgres://vproject_worker:vproject@db.example.ir:5432/vproject?sslmode=require',
      }),
    ).toThrow(/DATABASE_URL_WORKER/);
  });

  it('requires DATABASE_URL_IDENTITY on the API', () => {
    const config = loadApiConfig(validApiProduction);
    expect(config.DATABASE_URL_IDENTITY).toMatch(/vproject_identity/);
  });
});

describe('loadWorkerConfig', () => {
  it('loads a worker environment without the app URL', () => {
    const config = loadWorkerConfig({
      NODE_ENV: 'test',
      DATABASE_URL_WORKER: 'postgres://vproject_worker:vproject@127.0.0.1:5432/vproject',
      REDIS_URL: 'redis://127.0.0.1:6379',
    });
    expect(config.DATABASE_URL_WORKER).toMatch(/vproject_worker/);
  });

  it('forbids MIGRATION_DATABASE_URL on the worker in production', () => {
    expect(() =>
      loadWorkerConfig({
        ...validWorkerProduction,
        MIGRATION_DATABASE_URL:
          'postgres://vproject_migrator:vproject@db.example.ir:5432/vproject?sslmode=require',
      }),
    ).toThrow(/MIGRATION_DATABASE_URL/);
  });

  it('forbids app and identity URLs on the worker in production', () => {
    expect(() =>
      loadWorkerConfig({
        ...validWorkerProduction,
        DATABASE_URL_APP:
          'postgres://vproject_app:vproject@db.example.ir:5432/vproject?sslmode=require',
      }),
    ).toThrow(/DATABASE_URL_APP/);
  });

  it('R2-5: worker production does not require TRUST_PROXY_HOPS', () => {
    const { TRUST_PROXY_HOPS: _omit, ...withoutHops } = validWorkerProduction;
    expect(loadWorkerConfig(withoutHops).TRUST_PROXY_HOPS).toBe(0);
  });
});
