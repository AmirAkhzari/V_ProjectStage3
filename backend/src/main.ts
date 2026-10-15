import { buildApp } from './app.js';
import { loadConfigOrExit } from './platform/config.js';
import { createDb } from './platform/db/pool.js';
import { postgresHealthCheck, redisHealthCheck } from './platform/health.js';
import { createRedis } from './platform/redis.js';

const config = loadConfigOrExit();
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);

const app = await buildApp({
  config,
  healthChecks: [postgresHealthCheck(db.pool), redisHealthCheck(redis)],
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down api');
  await app.close();
  await redis.quit().catch(() => redis.disconnect());
  await db.close();
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
  process.exit(1);
}
