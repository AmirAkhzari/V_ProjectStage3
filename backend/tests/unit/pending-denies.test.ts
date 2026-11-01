import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { drainPendingDenies } from '../../src/modules/identity/infra/session/pgSessionStore.js';

describe('N12-2 drainPendingDenies', () => {
  it('never throws when listing pending rows fails; logs name/code only', async () => {
    const logs: { bindings: Record<string, unknown>; message: string }[] = [];
    const pool = {
      query: async () => {
        throw Object.assign(new Error('secret refreshToken=abc'), { code: '57P01' });
      },
    } as unknown as pg.Pool;

    await expect(
      drainPendingDenies(pool, async () => undefined, {
        error: (bindings, message) => logs.push({ bindings, message }),
      }),
    ).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('pending deny drain failed');
    expect(logs[0]?.bindings).toEqual({ err: { name: 'Error', code: '57P01' } });
    expect(JSON.stringify(logs)).not.toMatch(/refreshToken|secret/);
  });

  it('leaves rows pending when mark-done fails after a successful deny', async () => {
    const logs: string[] = [];
    let marked = false;
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('SELECT sid'))
          return { rows: [{ sid: '11111111-1111-1111-1111-111111111111' }] };
        if (sql.includes('SET done_at')) throw new Error('mark done exploded');
        if (sql.includes('SET attempts')) {
          marked = true;
          throw new Error('mark attempt also exploded');
        }
        return { rows: [] };
      },
    } as unknown as pg.Pool;

    await expect(
      drainPendingDenies(pool, async () => undefined, {
        error: (_bindings, message) => logs.push(message),
      }),
    ).resolves.toBeUndefined();
    expect(logs).toContain('pending deny mark failed');
    expect(marked).toBe(true);
  });
});
