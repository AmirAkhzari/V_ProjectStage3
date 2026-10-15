import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadConfig, loadWorkerConfig } from './config.js';

const validApi = {
  NODE_ENV: 'test',
  DATABASE_URL_APP: 'postgres://vproject_app:vproject@127.0.0.1:5432/vproject',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

const validApiProduction = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://vproject_app:vproject@db.example.ir:5432/vproject?sslmode=require',
  REDIS_URL: 'rediss://cache.example.ir:6379',
  LOG_LEVEL: 'info',
  OPENAPI_DOCS_ENABLED: 'false',
};

const validWorkerProduction = {
  NODE_ENV: 'production',
  DATABASE_URL_WORKER:
    'postgres://vproject_worker:vproject@db.example.ir:5432/vproject?sslmode=require',
  REDIS_URL: 'rediss://cache.example.ir:6379',
  LOG_LEVEL: 'info',
  OPENAPI_DOCS_ENABLED: 'false',
};

describe('loadApiConfig', () => {
  it('loads a complete API environment', () => {
    const config = loadConfig(validApi);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL_APP).toMatch(/vproject_app/);
    expect(config.OPENAPI_DOCS_ENABLED).toBe(false);
  });

  it('does not require worker, identity or migrator URLs', () => {
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

  it('rejects Postgres URLs without TLS in production', () => {
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        DATABASE_URL_APP: 'postgres://vproject_app:vproject@db.example.ir:5432/vproject',
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

  it('forbids worker and identity URLs on the API in production', () => {
    expect(() =>
      loadApiConfig({
        ...validApiProduction,
        DATABASE_URL_WORKER:
          'postgres://vproject_worker:vproject@db.example.ir:5432/vproject?sslmode=require',
      }),
    ).toThrow(/DATABASE_URL_WORKER/);
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
});
