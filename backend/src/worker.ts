import { assertStartupAdapters } from './platform/adapters.js';
import { loadWorkerConfigOrExit } from './platform/config.js';
import { createDb } from './platform/db/pool.js';
import { assertRuntimeDbRole } from './platform/db/runtimeRole.js';
import { InProcessEventBus } from './platform/events/bus.js';
import { PgInboxStore } from './platform/events/inboxPg.js';
import { PgOutboxStore } from './platform/events/outboxPg.js';
import { OutboxRelay } from './platform/events/relay.js';
import {
  outboxLagHealthCheck,
  postgresHealthCheck,
  redisHealthCheck,
  runHealthChecks,
} from './platform/health.js';
import { InMemoryJobQueue } from './platform/jobs/boss.js';
import { pinoOptions } from './platform/logger.js';
import { createRedis } from './platform/redis.js';
import { pino } from 'pino';

const config = loadWorkerConfigOrExit();
assertStartupAdapters(config.NODE_ENV);
const log = pino(pinoOptions(config));

const db = createDb(config.DATABASE_URL_WORKER, { log });
const redis = createRedis(config.REDIS_URL, log);

try {
  await assertRuntimeDbRole(db.pool);
} catch (error) {
  log.error({ err: error }, 'worker refused unsafe database role');
  await redis.quit().catch(() => redis.disconnect());
  await db.close();
  process.exit(1);
}

const inbox = new PgInboxStore(db.pool);
const bus = new InProcessEventBus(inbox);
const outbox = new PgOutboxStore(db.pool);
const relay = new OutboxRelay({
  store: outbox,
  bus,
  onError: (error) => log.error({ err: error }, 'outbox relay tick failed'),
});
const jobs = new InMemoryJobQueue();
await jobs.work('heartbeat', async () => {
  log.debug('worker heartbeat');
});

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  await relay.stop();
  await jobs.stop();
  await redis.quit().catch(() => redis.disconnect());
  await db.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const report = await runHealthChecks(
  [
    postgresHealthCheck(db.pool),
    redisHealthCheck(redis),
    outboxLagHealthCheck(db.pool, config.OUTBOX_LAG_THRESHOLD_MS),
  ],
  config.HEALTH_CHECK_TIMEOUT_MS,
);
log.info({ checks: report.checks }, 'worker dependencies');
relay.start(config.WORKER_POLL_INTERVAL_MS);
log.info('worker relay started');
