import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { runMigrations } from '../../src/platform/db/migrate.js';

export interface StartedDeps {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  databaseUrl: string;
  redisUrl: string;
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

export async function stopDeps(deps: StartedDeps): Promise<void> {
  await Promise.all([deps.postgres.stop(), deps.redis.stop()]);
}
