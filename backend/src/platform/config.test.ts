import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://vproject:vproject@127.0.0.1:5432/vproject',
  REDIS_URL: 'redis://127.0.0.1:6379',
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
});
