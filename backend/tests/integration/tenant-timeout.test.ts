import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withTenant } from '../../src/platform/db/tenant.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const LOCK_KEY = 74_001;

describe('TEN-TIMEOUT-01 tenant transactions fail closed instead of pinning the pool', () => {
  let pgRoles: StartedPostgresRoles;
  let appPool: pg.Pool;

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    appPool = new pg.Pool({ connectionString: pgRoles.appUrl, max: 2 });
    attachPgTeardownGuard(appPool);
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await pgRoles?.postgres.stop();
  });

  it('cancels a slow statement with 503 and keeps the connection reusable', async () => {
    await expect(
      withTenant(
        appPool,
        { subjectType: 'system' },
        ({ client }) => client.query('SELECT pg_sleep(1)'),
        { statementTimeoutMs: 100 },
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });

    const after = await withTenant(appPool, { subjectType: 'system' }, ({ client }) =>
      client.query<{ ok: number }>('SELECT 1 AS ok'),
    );
    expect(after.rows[0]?.ok).toBe(1);
    expect(appPool.idleCount).toBe(1);
  });

  it('gives up on a blocked lock with 503 and leaves no GUCs behind', async () => {
    const blocker = await appPool.connect();
    try {
      await blocker.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
      await expect(
        withTenant(
          appPool,
          { subjectType: 'staff', distributorId: '01000000-0000-4000-8000-000000000001' },
          ({ client }) => client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]),
          { lockTimeoutMs: 100 },
        ),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
      blocker.release();
    }

    const settings = await appPool.query<{ distributor_id: string | null; timeout: string }>(
      `SELECT current_setting('app.distributor_id', true) AS distributor_id,
              current_setting('statement_timeout', true) AS timeout`,
    );
    // An unset GUC reads back as NULL; either way it must not carry this tenant's id.
    expect(settings.rows[0]?.distributor_id ?? '').toBe('');
    expect(settings.rows[0]?.timeout ?? '0').toBe('0');
  });

  it('applies the defaults through a real transaction without a custom limit', async () => {
    const result = await withTenant(appPool, { subjectType: 'system' }, ({ client }) =>
      client.query<{ statement_timeout: string; lock_timeout: string }>(
        `SELECT current_setting('statement_timeout') AS statement_timeout,
                current_setting('lock_timeout') AS lock_timeout`,
      ),
    );
    expect(result.rows[0]).toEqual({ statement_timeout: '5s', lock_timeout: '2s' });
  });
});
