import { loadApiConfig, type ApiConfig } from '../../src/platform/config.js';

export function testConfig(overrides: Record<string, string | undefined> = {}): ApiConfig {
  return loadApiConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: 'postgres://vproject_app:vproject@127.0.0.1:5432/vproject',
    REDIS_URL: 'redis://127.0.0.1:6379',
    ...overrides,
  });
}

export function productionApiConfig(overrides: Record<string, string | undefined> = {}): ApiConfig {
  return loadApiConfig({
    NODE_ENV: 'production',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP:
      'postgres://vproject_app:vproject@db.example.ir:5432/vproject?sslmode=require',
    REDIS_URL: 'rediss://cache.example.ir:6379',
    OPENAPI_DOCS_ENABLED: 'false',
    ...overrides,
  });
}
