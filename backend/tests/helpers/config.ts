import { loadConfig, type Config } from '../../src/platform/config.js';

export function testConfig(overrides: Record<string, string | undefined> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://vproject:vproject@127.0.0.1:5432/vproject',
    REDIS_URL: 'redis://127.0.0.1:6379',
    ...overrides,
  });
}
