import { buildApp } from './app.js';
import { createIdentityDb } from './modules/identity/infra/db/pool.js';
import { configureSessionTtl } from './modules/identity/domain/sessionTtl.js';
import { Argon2idPasswordHasher } from './modules/identity/infra/crypto/argon2Hasher.js';
import { PgRefreshTokenStore } from './modules/identity/infra/crypto/pgRefreshStore.js';
import { PgSessionStore } from './modules/identity/infra/session/pgSessionStore.js';
import { assertAdapterAllowed, assertStartupAdapters } from './platform/adapters.js';
import { createJwtFromEnv } from './platform/auth/eddsa.js';
import { assertRedisForAuthIssuance } from './platform/auth/failClosed.js';
import { startPendingDenyWorker } from './modules/identity/application/pendingDenyWorker.js';
import { fallbackPoolOptions, RedisPgSessionAuthority } from './platform/auth/sessionAuthority.js';
import { loadConfigOrExit } from './platform/config.js';
import { createDb } from './platform/db/pool.js';
import { DB_ROLE_NAMES } from './platform/db/roles.js';
import { assertRuntimeDbRole } from './platform/db/runtimeRole.js';
import { outboxLagHealthCheck, postgresHealthCheck, redisHealthCheck } from './platform/health.js';
import { pinoOptions } from './platform/logger.js';
import { createRedis } from './platform/redis.js';
import pg from 'pg';
import { pino } from 'pino';

const config = loadConfigOrExit();
assertStartupAdapters(config.NODE_ENV);
assertAdapterAllowed('sms', config.SMS_PROVIDER, config.NODE_ENV);
configureSessionTtl({
  shopkeeperAbsoluteMs: config.SESSION_TTL_SHOPKEEPER_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
  shopkeeperIdleMs: config.SESSION_TTL_SHOPKEEPER_SLIDING_DAYS * 24 * 60 * 60 * 1000,
  staffAbsoluteMs: config.SESSION_TTL_STAFF_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
  staffIdleMs: config.SESSION_TTL_STAFF_IDLE_HOURS * 60 * 60 * 1000,
  driverAbsoluteMs: config.SESSION_TTL_DRIVER_ABSOLUTE_HOURS * 60 * 60 * 1000,
});
const log = pino(pinoOptions(config));
const db = createDb(config.DATABASE_URL_APP, { log });
const identityDb = createIdentityDb(config.DATABASE_URL_IDENTITY, { log });
const sessionLookupPool = new pg.Pool(fallbackPoolOptions(config.DATABASE_URL_IDENTITY));
const redis = createRedis(config.REDIS_URL, log);
const sessionAuthority = new RedisPgSessionAuthority(redis, new PgSessionStore(sessionLookupPool));
const verifier = await createJwtFromEnv();
const hasher = new Argon2idPasswordHasher();
const refreshStore = new PgRefreshTokenStore(identityDb.pool, {
  onSidsRevoked: (sids) => sessionAuthority.deny(sids),
  log,
});

const stopPendingDenyWorker = startPendingDenyWorker({
  pool: identityDb.pool,
  deny: (sids) => sessionAuthority.deny(sids),
  log,
  intervalMs: config.WORKER_POLL_INTERVAL_MS,
});

const closeInfra = async () => {
  stopPendingDenyWorker();
  await redis.quit().catch(() => redis.disconnect());
  await Promise.all([sessionLookupPool.end(), identityDb.close(), db.close()]);
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
  verifier,
  sessionAuthority,
  assertIssuance: () => assertRedisForAuthIssuance(redis),
  driverAuth: {
    identityPool: identityDb.pool,
    redis,
    jwt: verifier,
    authority: sessionAuthority,
    store: refreshStore,
    hasher,
    log,
    auditHashKey: config.AUDIT_HASH_KEY,
  },
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
