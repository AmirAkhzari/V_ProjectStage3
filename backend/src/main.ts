import { buildApp } from './app.js';
import { loadConfigOrExit } from './platform/config.js';
import { createRoleDb } from './platform/db/pool.js';
import { outboxLagHealthCheck, postgresHealthCheck, redisHealthCheck } from './platform/health.js';
import { createRedis } from './platform/redis.js';

const config = loadConfigOrExit();
const db = createRoleDb(config, 'app');
const identityDb = createRoleDb(config, 'identity');
const redis = createRedis(config.REDIS_URL);

const app = await buildApp({
  config,
  healthChecks: [
    postgresHealthCheck(db.pool),
    redisHealthCheck(redis),
    outboxLagHealthCheck(db.pool, config.OUTBOX_LAG_THRESHOLD_MS),
  ],
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down api');
  await app.close();
  await redis.quit().catch(() => redis.disconnect());
  await db.close();
  await identityDb.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'api failed to start');
  await redis.quit().catch(() => redis.disconnect());
  await db.close();
  await identityDb.close();
  process.exit(1);
}
