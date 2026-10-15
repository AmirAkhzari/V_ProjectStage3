import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { createDb } from '../../src/platform/db/pool.js';
import { postgresHealthCheck, redisHealthCheck } from '../../src/platform/health.js';
import { createRedis } from '../../src/platform/redis.js';
import { testConfig } from '../helpers/config.js';
import { startDeps, stopDeps, type StartedDeps } from '../helpers/containers.js';

describe('health against real Postgres 16 and Redis 7', () => {
  let deps: StartedDeps;
  let app: App;
  let closeDb: () => Promise<void>;
  let closeRedis: () => Promise<void>;

  beforeAll(async () => {
    deps = await startDeps();
    const db = createDb(deps.databaseUrl);
    const redis = createRedis(deps.redisUrl);
    closeDb = () => db.close();
    closeRedis = async () => {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    };
    app = await buildApp({
      config: testConfig({
        DATABASE_URL: deps.databaseUrl,
        REDIS_URL: deps.redisUrl,
      }),
      healthChecks: [postgresHealthCheck(db.pool), redisHealthCheck(redis)],
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await closeRedis();
    await closeDb();
    await stopDeps(deps);
  });

  it('GET /health is 200 with both dependencies up', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; checks: Record<string, { status: string }> };
    expect(body.status).toBe('ok');
    expect(body.checks['postgres']?.status).toBe('up');
    expect(body.checks['redis']?.status).toBe('up');
  });

  it('GET /ready is 200 when dependencies are up', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
  });
});
