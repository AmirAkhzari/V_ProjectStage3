import { buildApp } from './app.js';
import { createIdentityDb } from './modules/identity/infra/db/pool.js';
import { assertStartupAdapters } from './platform/adapters.js';
import { loadConfigOrExit } from './platform/config.js';
import { createDb } from './platform/db/pool.js';
import { DB_ROLE_NAMES } from './platform/db/roles.js';
import { assertRuntimeDbRole } from './platform/db/runtimeRole.js';
import { outboxLagHealthCheck, postgresHealthCheck, redisHealthCheck } from './platform/health.js';
import { pinoOptions } from './platform/logger.js';
import { createRedis } from './platform/redis.js';
import { pino } from 'pino';

const config = loadConfigOrExit();
assertStartupAdapters(config.NODE_ENV);
const log = pino(pinoOptions(config));
const db = createDb(config.DATABASE_URL_APP, { log });
const identityDb = createIdentityDb(config.DATABASE_URL_IDENTITY, { log });
const redis = createRedis(config.REDIS_URL, log);

const closeInfra = async () => {
  await redis.quit().catch(() => redis.disconnect());
  await Promise.all([identityDb.close(), db.close()]);
};

try {
  await assertRuntimeDbRole(db.pool, DB_ROLE_NAMES.app);
  await assertRuntimeDbRole(identityDb.pool, DB_ROLE_NAMES.identity);
} catch (error) {
  log.error({ err: error }, 'api refused unsafe database role');
  await closeInfra();
  process.exit(1);
}

const app = await buildApp({
  config,
  healthChecks: [
    postgresHealthCheck(db.pool),
    postgresHealthCheck(identityDb.pool, 'postgres_identity'),
    redisHealthCheck(redis),
    outboxLagHealthCheck(db.pool, config.OUTBOX_LAG_THRESHOLD_MS),
  ],
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down api');
  await app.close();
  await closeInfra();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'api failed to start');
  await closeInfra();
  process.exit(1);
}
