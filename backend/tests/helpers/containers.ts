import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { runMigrations } from '../../src/platform/db/migrate.js';
import { databaseUrlAs } from '../../src/platform/db/roles.js';

/** N10-1: swallow only admin-terminate; every other pool error rethrows (A-11-11). */
export function ignoreAdminTerminate(err: Error & { code?: string }): void {
  if (err.code === '57P01') return;
  throw err;
}

export function attachPgTeardownGuard(pool: pg.Pool): void {
  pool.on('error', ignoreAdminTerminate);
  pool.on('connect', (client) => {
    client.on('error', ignoreAdminTerminate);
  });
}

export const TEST_ROLE_PASSWORD = 'vproject-test';

export interface StartedDeps {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  databaseUrl: string;
  redisUrl: string;
}

export interface StartedPostgresRoles {
  postgres: StartedPostgreSqlContainer;
  ownerUrl: string;
  appUrl: string;
  workerUrl: string;
  identityUrl: string;
}

export interface StartedTestRedis {
  getConnectionUrl(): string;
  stop(): Promise<void>;
}

/**
 * `TEST_REDIS_SERVER_BIN` points the harness at a local `redis-server` binary (no Docker daemon).
 * Every suite gets its own server on a free port, so parallel files never share a keyspace.
 */
const redisServerBin = process.env['TEST_REDIS_SERVER_BIN'];

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function pingRedis(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', (chunk) => finish(chunk.toString().includes('PONG')));
  });
}

export async function startRedis(): Promise<StartedTestRedis> {
  if (!redisServerBin) {
    const container = await new RedisContainer('redis:7-alpine').start();
    return {
      getConnectionUrl: () => container.getConnectionUrl(),
      stop: async () => {
        await container.stop();
      },
    };
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await freePort();
    const child = spawn(
      redisServerBin,
      [
        '--port',
        String(port),
        '--bind',
        '127.0.0.1',
        '--save',
        '',
        '--appendonly',
        'no',
        '--dir',
        tmpdir(),
      ],
      { stdio: 'ignore' },
    );
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    let ready = false;
    for (let probe = 0; probe < 50 && !ready; probe += 1) {
      if (child.exitCode !== null) break;
      ready = await pingRedis(port);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ready) {
      return {
        getConnectionUrl: () => `redis://127.0.0.1:${port}`,
        async stop() {
          if (child.exitCode !== null) return;
          child.kill('SIGTERM');
          await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
          if (child.exitCode === null) child.kill('SIGKILL');
          await exited;
        },
      };
    }
    child.kill('SIGKILL');
    await exited;
  }
  throw new Error('startRedis: could not start a local redis-server');
}

export async function startDeps(): Promise<StartedDeps> {
  if (externalAdminUrl) {
    const database = await createExternalDatabase(externalAdminUrl, { applyRoles: false });
    const redis = await startRedis();
    return {
      postgres: database.postgres,
      redis: redis as unknown as StartedRedisContainer,
      databaseUrl: database.ownerUrl,
      redisUrl: redis.getConnectionUrl(),
    };
  }
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

/**
 * `TEST_PG_ADMIN_URL` points the harness at a Postgres that is already running (a sandbox without a
 * Docker daemon, or a CI service container). Every suite gets its own database there, because vitest
 * runs the files in parallel: a single shared database makes the suites race on the same migrations,
 * role DDL and fixed seed ids. The cluster is disposable, so the databases are dropped on stop.
 */
const externalAdminUrl = process.env['TEST_PG_ADMIN_URL'];

/** vitest runs suites in worker processes, so the cluster-wide role DDL is serialized in Postgres. */
const ROLE_DDL_LOCK_KEY = 728_510_394;

function databaseUrlWithName(adminUrl: string, database: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

function roleUrls(ownerUrl: string): Omit<StartedPostgresRoles, 'postgres' | 'ownerUrl'> {
  return {
    appUrl: databaseUrlAs(ownerUrl, 'vproject_app', TEST_ROLE_PASSWORD),
    workerUrl: databaseUrlAs(ownerUrl, 'vproject_worker', TEST_ROLE_PASSWORD),
    identityUrl: databaseUrlAs(ownerUrl, 'vproject_identity', TEST_ROLE_PASSWORD),
  };
}

async function createExternalDatabase(
  adminUrl: string,
  options: { applyRoles: boolean } = { applyRoles: true },
): Promise<StartedPostgresRoles> {
  const database = `vproject_test_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(database)}`);
    created = true;
    const ownerUrl = databaseUrlWithName(adminUrl, database);
    if (options.applyRoles) {
      await admin.query('SELECT pg_advisory_lock($1)', [ROLE_DDL_LOCK_KEY]);
      try {
        await runMigrations(ownerUrl, {
          applyRoles: true,
          nodeEnv: 'test',
          rolePassword: TEST_ROLE_PASSWORD,
        });
      } finally {
        await admin.query('SELECT pg_advisory_unlock($1)', [ROLE_DDL_LOCK_KEY]);
      }
    } else {
      await runMigrations(ownerUrl);
    }
    const stop = async (): Promise<void> => {
      const session = new pg.Client({ connectionString: adminUrl });
      await session.connect();
      try {
        await session.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [database],
        );
        await session.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(database)}`);
      } finally {
        await session.end();
      }
    };
    return {
      postgres: { stop } as unknown as StartedPostgreSqlContainer,
      ownerUrl,
      ...roleUrls(ownerUrl),
    };
  } catch (error) {
    if (created) {
      await admin
        .query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(database)} WITH (FORCE)`)
        .catch(() => {});
    }
    throw error;
  } finally {
    await admin.end();
  }
}

export async function startPostgresWithRoles(): Promise<StartedPostgresRoles> {
  if (externalAdminUrl) return createExternalDatabase(externalAdminUrl);
  const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  const ownerUrl = postgres.getConnectionUri();
  await runMigrations(ownerUrl, {
    applyRoles: true,
    nodeEnv: 'test',
    rolePassword: TEST_ROLE_PASSWORD,
  });
  return { postgres, ownerUrl, ...roleUrls(ownerUrl) };
}

export async function stopDeps(deps: StartedDeps): Promise<void> {
  await Promise.all([deps.postgres.stop(), deps.redis.stop()]);
}
