import { loadConfigOrExit } from './platform/config.js';
import { createRoleDb } from './platform/db/pool.js';
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

const config = loadConfigOrExit();
const log = pino(pinoOptions(config));

const db = createRoleDb(config, 'worker');
const redis = createRedis(config.REDIS_URL);

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
