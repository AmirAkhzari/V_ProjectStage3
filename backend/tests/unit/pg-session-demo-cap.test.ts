import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgSessionStore } from '../../src/modules/identity/infra/session/pgSessionStore.js';

const row = {
  sid: '11111111-1111-4111-8111-111111111111',
  account_id: '22222222-2222-4222-8222-222222222222',
  typ: 'staff',
  family_id: '33333333-3333-4333-8333-333333333333',
  revoked_at: null,
  session_version: 1,
  account_status: 'active',
  distributor_id: '44444444-4444-4444-8444-444444444444',
  staff_role: 'distributor_admin',
  permissions: ['dashboard.view', 'orders.update'],
  must_change_password: false,
};

function poolReturning(isDemo: boolean | null): pg.Pool {
  return {
    query: async () => ({ rows: [{ ...row, is_demo: isDemo }] }),
  } as unknown as pg.Pool;
}

describe('session lookup demo cap', () => {
  it('treats a null is_demo as demo', async () => {
    const snap = await new PgSessionStore(poolReturning(null)).lookup(row.sid);
    expect(snap?.permissions).toEqual(['dashboard.view']);
  });

  it('leaves a non-demo distributor admin uncapped', async () => {
    const snap = await new PgSessionStore(poolReturning(false)).lookup(row.sid);
    expect(snap?.permissions).toEqual(['dashboard.view', 'orders.update']);
  });
});
