import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config.js';
import { loadMigrateDatabaseUrl } from './migrate.js';

describe('loadMigrateDatabaseUrl', () => {
  it('requires MIGRATION_DATABASE_URL only', () => {
    expect(() => loadMigrateDatabaseUrl({ NODE_ENV: 'test' })).toThrow(ConfigError);
    const url = loadMigrateDatabaseUrl({
      NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: 'postgres://vproject_migrator:x@127.0.0.1:5432/vproject',
    });
    expect(url).toMatch(/vproject_migrator/);
  });

  it('refuses app and worker role URLs', () => {
    expect(() =>
      loadMigrateDatabaseUrl({
        MIGRATION_DATABASE_URL: 'postgres://vproject_app:x@127.0.0.1:5432/vproject',
      }),
    ).toThrow(/must not use the app, worker, or identity role/);
    expect(() =>
      loadMigrateDatabaseUrl({
        MIGRATION_DATABASE_URL: 'postgres://vproject_worker:x@127.0.0.1:5432/vproject',
      }),
    ).toThrow(/must not use the app, worker, or identity role/);
    expect(() =>
      loadMigrateDatabaseUrl({
        MIGRATION_DATABASE_URL: 'postgres://vproject_identity:x@127.0.0.1:5432/vproject',
      }),
    ).toThrow(/must not use the app, worker, or identity role/);
  });

  it('requires TLS in production', () => {
    expect(() =>
      loadMigrateDatabaseUrl({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: 'postgres://vproject_migrator:x@db.example.ir:5432/vproject',
      }),
    ).toThrow(/TLS/);
    expect(
      loadMigrateDatabaseUrl({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgres://vproject_migrator:x@db.example.ir:5432/vproject?sslmode=require',
      }),
    ).toMatch(/sslmode=require/);
  });
});
