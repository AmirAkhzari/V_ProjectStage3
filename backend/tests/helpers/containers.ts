import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type pg from 'pg';
import { runMigrations } from '../../src/platform/db/migrate.js';
import { databaseUrlAs } from '../../src/platform/db/roles.js';

/** N10-1: register before container stop so 57P01 on closing clients is not an unhandled error. */
export function ignoreAdminTerminate(err: Error & { code?: string }): void {
  if (err.code === '57P01') return;
}

export function attachPgTeardownGuard(pool: pg.Pool): void {
  pool.on('error', ignoreAdminTerminate);
  pool.on('connect', (client) => {
    client.on('error', ignoreAdminTerminate);
  });
}

export const TEST_ROLE_PASSWORD = 'vproject-test';

export interface StartedDeps {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  databaseUrl: string;
  redisUrl: string;
}

export interface StartedPostgresRoles {
  postgres: StartedPostgreSqlContainer;
  ownerUrl: string;
  appUrl: string;
  workerUrl: string;
  identityUrl: string;
}

export async function startDeps(): Promise<StartedDeps> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const databaseUrl = postgres.getConnectionUri();
  await runMigrations(databaseUrl);
  return {
    postgres,
    redis,
    databaseUrl,
    redisUrl: redis.getConnectionUrl(),
  };
}

export async function startPostgresWithRoles(): Promise<StartedPostgresRoles> {
  const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  const ownerUrl = postgres.getConnectionUri();
  await runMigrations(ownerUrl, {
    applyRoles: true,
    nodeEnv: 'test',
    rolePassword: TEST_ROLE_PASSWORD,
  });
  return {
    postgres,
    ownerUrl,
    appUrl: databaseUrlAs(ownerUrl, 'vproject_app', TEST_ROLE_PASSWORD),
    workerUrl: databaseUrlAs(ownerUrl, 'vproject_worker', TEST_ROLE_PASSWORD),
    identityUrl: databaseUrlAs(ownerUrl, 'vproject_identity', TEST_ROLE_PASSWORD),
  };
}

export async function stopDeps(deps: StartedDeps): Promise<void> {
  await Promise.all([deps.postgres.stop(), deps.redis.stop()]);
}
