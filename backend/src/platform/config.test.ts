import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://vproject:vproject@127.0.0.1:5432/vproject',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

const validProduction = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://vproject:vproject@db.example.ir:5432/vproject?sslmode=require',
  REDIS_URL: 'rediss://cache.example.ir:6379',
  LOG_LEVEL: 'info',
  OPENAPI_DOCS_ENABLED: 'false',
};

describe('loadConfig', () => {
  it('loads a complete environment', () => {
    const config = loadConfig(valid);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.OPENAPI_DOCS_ENABLED).toBe(false);
  });

  it('exits-ready error names each missing field', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(ConfigError);
    try {
      loadConfig({ NODE_ENV: 'test' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues.map((i) => i.field);
      expect(issues).toContain('DATABASE_URL');
      expect(issues).toContain('REDIS_URL');
      expect((error as ConfigError).message).toMatch(/DATABASE_URL/);
    }
  });

  it('rejects a non-postgres database url', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      ConfigError,
    );
  });

  it('accepts production with TLS urls and docs disabled', () => {
    const config = loadConfig(validProduction);
    expect(config.NODE_ENV).toBe('production');
    expect(config.OPENAPI_DOCS_ENABLED).toBe(false);
  });

  it('rejects OpenAPI docs in production', () => {
    expect(() => loadConfig({ ...validProduction, OPENAPI_DOCS_ENABLED: 'true' })).toThrow(
      ConfigError,
    );
    try {
      loadConfig({ ...validProduction, OPENAPI_DOCS_ENABLED: 'true' });
    } catch (error) {
      expect((error as ConfigError).issues.some((i) => i.field === 'OPENAPI_DOCS_ENABLED')).toBe(
        true,
      );
    }
  });

  it('rejects debug/trace log levels in production', () => {
    expect(() => loadConfig({ ...validProduction, LOG_LEVEL: 'debug' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validProduction, LOG_LEVEL: 'trace' })).toThrow(ConfigError);
  });

  it('rejects DEMO_* flags in production', () => {
    expect(() => loadConfig({ ...validProduction, DEMO_LOGIN_ENABLED: 'true' })).toThrow(
      ConfigError,
    );
  });

  it('rejects MOCK_* flags in production', () => {
    expect(() => loadConfig({ ...validProduction, MOCK_SMS: 'true' })).toThrow(ConfigError);
  });

  it('rejects *_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...validProduction, PAYMENT_PROVIDER: 'mock' })).toThrow(ConfigError);
  });

  it('rejects Postgres URLs without TLS in production', () => {
    expect(() =>
      loadConfig({
        ...validProduction,
        DATABASE_URL: 'postgres://vproject:vproject@db.example.ir:5432/vproject',
      }),
    ).toThrow(ConfigError);
  });

  it('rejects Redis URLs without TLS in production', () => {
    expect(() =>
      loadConfig({
        ...validProduction,
        REDIS_URL: 'redis://cache.example.ir:6379',
      }),
    ).toThrow(ConfigError);
  });
});
