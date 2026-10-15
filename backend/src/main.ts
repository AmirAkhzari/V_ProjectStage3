import { buildApp } from './app.js';
import { assertStartupAdapters } from './platform/adapters.js';
import { loadConfigOrExit } from './platform/config.js';
import { createDb } from './platform/db/pool.js';
import { outboxLagHealthCheck, postgresHealthCheck, redisHealthCheck } from './platform/health.js';
import { pinoOptions } from './platform/logger.js';
import { createRedis } from './platform/redis.js';
import { pino } from 'pino';

const config = loadConfigOrExit();
assertStartupAdapters(config.NODE_ENV);
const log = pino(pinoOptions(config));
const db = createDb(config.DATABASE_URL_APP, { log });
const redis = createRedis(config.REDIS_URL, log);

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
