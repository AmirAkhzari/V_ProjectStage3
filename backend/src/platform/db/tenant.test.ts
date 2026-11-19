import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { withTenant, TENANT_LOCK_TIMEOUT_MS, TENANT_STATEMENT_TIMEOUT_MS } from './tenant.js';

interface Call {
  sql: string;
  params: unknown[];
}

function recordingPool(outcome?: () => Promise<unknown>) {
  const calls: Call[] = [];
  let releases = 0;
  const client = {
    query: vi.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (outcome && sql !== 'BEGIN' && sql !== 'ROLLBACK' && sql !== 'COMMIT') {
        return outcome();
      }
      return Promise.resolve({ rows: [] });
    }),
    release: () => {
      releases += 1;
    },
  };
  return {
    pool: { connect: () => Promise.resolve(client) } as unknown as pg.Pool,
    calls,
    releases: () => releases,
  };
}

function setConfigCalls(calls: Call[]): [string, string][] {
  return calls
    .filter((call) => call.sql.includes('set_config'))
    .map((call) => [String(call.params[0]), String(call.params[1])]);
}

describe('withTenant query limits', () => {
  it('sets statement and lock timeouts locally before the tenant GUCs', async () => {
    const fake = recordingPool();
    await expect(
      withTenant(fake.pool, { subjectType: 'staff', distributorId: 'd-1' }, () =>
        Promise.resolve(1),
      ),
    ).resolves.toBe(1);

    const configs = setConfigCalls(fake.calls);
    expect(configs.slice(0, 2)).toEqual([
      ['statement_timeout', `${TENANT_STATEMENT_TIMEOUT_MS}ms`],
      ['lock_timeout', `${TENANT_LOCK_TIMEOUT_MS}ms`],
    ]);
    expect(configs).toContainEqual(['app.distributor_id', 'd-1']);
    for (const call of fake.calls.filter((c) => c.sql.includes('set_config'))) {
      expect(call.params[2]).toBeUndefined();
      expect(call.sql).toContain(', true)');
    }
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT');
    expect(fake.releases()).toBe(1);
  });

  it('honours stricter per-call limits', async () => {
    const fake = recordingPool();
    await withTenant(fake.pool, { subjectType: 'system' }, () => Promise.resolve(null), {
      statementTimeoutMs: 250,
      lockTimeoutMs: 50,
    });
    expect(setConfigCalls(fake.calls).slice(0, 2)).toEqual([
      ['statement_timeout', '250ms'],
      ['lock_timeout', '50ms'],
    ]);
  });

  it.each(['57014', '55P03'])('maps SQLSTATE %s to a 503 and rolls back first', async (code) => {
    const fake = recordingPool(() => Promise.reject(Object.assign(new Error('timeout'), { code })));
    await expect(
      withTenant(fake.pool, { subjectType: 'staff', isPlatform: true }, () => Promise.resolve(1)),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      details: { retryAfter: 5 },
    });

    const sql = fake.calls.map((call) => call.sql);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(fake.releases()).toBe(1);
  });

  it('rethrows other database errors unchanged', async () => {
    const original = Object.assign(new Error('duplicate key'), { code: '23505' });
    const fake = recordingPool(() => Promise.reject(original));
    await expect(
      withTenant(fake.pool, { subjectType: 'system' }, () => Promise.resolve(1)),
    ).rejects.toBe(original);
    expect(fake.calls.map((call) => call.sql)).not.toContain('COMMIT');
    expect(fake.releases()).toBe(1);
  });

  it('keeps the original error when ROLLBACK itself fails', async () => {
    const fake = recordingPool();
    fake.pool.connect = () =>
      Promise.resolve({
        query: (sql: string) => {
          if (sql === 'ROLLBACK') return Promise.reject(new Error('connection gone'));
          return Promise.resolve({ rows: [] });
        },
        release: () => undefined,
      } as unknown as pg.PoolClient);
    await expect(
      withTenant(fake.pool, { subjectType: 'system' }, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});
