import { loadConfigOrExit } from './platform/config.js';
import { createDb } from './platform/db/pool.js';
import { InProcessEventBus } from './platform/events/bus.js';
import { InMemoryInboxStore } from './platform/events/inbox.js';
import { InMemoryOutboxStore } from './platform/events/outbox.js';
import { OutboxRelay } from './platform/events/relay.js';
import { postgresHealthCheck, redisHealthCheck, runHealthChecks } from './platform/health.js';
import { InMemoryJobQueue } from './platform/jobs/boss.js';
import { pinoOptions } from './platform/logger.js';
import { createRedis } from './platform/redis.js';
import { pino } from 'pino';

const config = loadConfigOrExit();
const log = pino(pinoOptions(config));

const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);

const inbox = new InMemoryInboxStore();
const bus = new InProcessEventBus(inbox);
const outbox = new InMemoryOutboxStore();
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
  [postgresHealthCheck(db.pool), redisHealthCheck(redis)],
  config.HEALTH_CHECK_TIMEOUT_MS,
);
log.info({ checks: report.checks }, 'worker dependencies');
relay.start(config.WORKER_POLL_INTERVAL_MS);
log.info('worker relay started (in-memory store until platform.outbox_events is authorized)');
