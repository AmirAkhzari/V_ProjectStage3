import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type {
  SessionAuthority,
  SessionSnapshot,
} from '../../src/platform/auth/sessionAuthority.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const DIST_1 = '01000000-0000-4000-8000-000000000001';
const DIST_2 = '01000000-0000-4000-8000-000000000002';

const SHOP_A = '02000000-0000-4000-8000-00000000000a';
const SHOP_B = '02000000-0000-4000-8000-00000000000b';
const SHOP_C = '02000000-0000-4000-8000-00000000000c';
const SHOP_D = '02000000-0000-4000-8000-00000000000d';
const SHOP_DEMO = '02000000-0000-4000-8000-0000000000de';
const SHOP_MISSING = '02000000-0000-4000-8000-0000000000ff';

interface Principal {
  sid: string;
  accountId: string;
  status: 'active' | 'inactive';
}

const PRINCIPALS = new Map<string, Principal>([
  ['tok-a', { sid: 'sid-a', accountId: SHOP_A, status: 'active' }],
  ['tok-b', { sid: 'sid-b', accountId: SHOP_B, status: 'active' }],
  ['tok-c', { sid: 'sid-c', accountId: SHOP_C, status: 'active' }],
  ['tok-d', { sid: 'sid-d', accountId: SHOP_D, status: 'active' }],
  ['tok-demo', { sid: 'sid-demo', accountId: SHOP_DEMO, status: 'active' }],
  ['tok-missing', { sid: 'sid-missing', accountId: SHOP_MISSING, status: 'active' }],
  ['tok-inactive', { sid: 'sid-inactive', accountId: SHOP_A, status: 'inactive' }],
]);

const verifier: AccessTokenVerifier = {
  verify: (token) => {
    const principal = PRINCIPALS.get(token);
    if (!principal) return Promise.reject(new Error('unknown token'));
    return Promise.resolve({
      sub: principal.accountId,
      typ: 'shopkeeper',
      sid: principal.sid,
      sv: 0,
    });
  },
};

function snapshotOf(principal: Principal): SessionSnapshot {
  return {
    sid: principal.sid,
    accountId: principal.accountId,
    typ: 'shopkeeper',
    familyId: `family-${principal.sid}`,
    sessionVersion: 0,
    accountStatus: principal.status,
    revokedAt: null,
    distributorId: null,
    staffRole: null,
    permissions: [],
    mustChangePassword: false,
  };
}

const authority: SessionAuthority = {
  hasPgFallback: true,
  check: (sid) => {
    for (const principal of PRINCIPALS.values()) {
      if (principal.sid !== sid) continue;
      if (principal.status !== 'active') {
        return Promise.resolve({ status: 'inactive' as const, row: snapshotOf(principal) });
      }
      return Promise.resolve({ status: 'active' as const, row: snapshotOf(principal) });
    }
    return Promise.resolve({ status: 'revoked' as const, reason: 'missing' });
  },
  rememberLive: () => Promise.resolve(),
  deny: () => Promise.resolve(),
  invalidateLive: () => Promise.resolve(),
  breakerState: () => 'closed',
  pgFallbackTotal: () => 0,
  pgLookupsFor: () => 0,
};

describe('A7 /v1/app/me tenant isolation', () => {
  let pgRoles: StartedPostgresRoles;
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let app: App;

  beforeAll(async () => {
    pgRoles = await startPostgresWithRoles();
    appPool = new pg.Pool({ connectionString: pgRoles.appUrl, max: 4 });
    ownerPool = new pg.Pool({ connectionString: pgRoles.ownerUrl, max: 2 });
    attachPgTeardownGuard(appPool);
    attachPgTeardownGuard(ownerPool);
    // Production seeds shopkeepers.id = account_id.
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, primary_distributor_id, status, created_at)
       VALUES ($1, $1, '09120000000a', $6, 'active', now()),
              ($2, $2, '09120000000b', $6, 'active', now()),
              ($3, $3, '09120000000c', $7, 'active', now()),
              ($4, $4, '09120000000d', $6, 'blocked', now()),
              ($5, $5, '0912000000de', NULL, 'active', now())`,
      [SHOP_A, SHOP_B, SHOP_C, SHOP_D, SHOP_DEMO, DIST_1, DIST_2],
    );
    app = await buildApp({
      config: { ...testConfig(), DEPLOY_ENV: 'staging', DEMO_LOGIN_ENABLED: 'true' },
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
      appDb: appPool,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await appPool?.end();
    await ownerPool?.end();
    await pgRoles?.postgres.stop();
  });

  const get = (token: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: '/v1/app/me',
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  it('shopkeeper A only ever sees A, even when B shares its distributor', async () => {
    const own = await get('tok-a');
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()).toMatchObject({ user: { id: SHOP_A, phone: '09120000000a' } });
    const other = await get('tok-b');
    expect(other.json()).toMatchObject({ user: { id: SHOP_B } });
    expect(other.json().user.id).not.toBe(SHOP_A);
  });

  it('a different-distributor shopkeeper is isolated too', async () => {
    const c = await get('tok-c');
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json()).toMatchObject({ user: { id: SHOP_C } });
  });

  it('the demo shopkeeper sees only its own row', async () => {
    const demo = await get('tok-demo');
    expect(demo.statusCode, demo.body).toBe(200);
    expect(demo.json()).toMatchObject({ user: { id: SHOP_DEMO } });
  });

  it('a valid session without a shopkeeper row is 404', async () => {
    const response = await get('tok-missing');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('an inactive account is 401, not 200', async () => {
    const response = await get('tok-inactive');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
  });

  it('an inactive shopkeeper row under an active account is 404, not 200', async () => {
    const response = await get('tok-d');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('X-Scope-Distributor does not change the returned row', async () => {
    const plain = await get('tok-a');
    const scoped = await get('tok-a', { 'x-scope-distributor': randomUUID() });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toEqual(plain.json());
  });
});
