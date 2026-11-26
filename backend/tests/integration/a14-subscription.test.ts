import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type {
  SessionAuthority,
  SessionSnapshot,
} from '../../src/platform/auth/sessionAuthority.js';
import { productionApiConfig, testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const SHOP_FREE = '03000000-0000-4000-8000-00000000000a';
const SHOP_PRO = '03000000-0000-4000-8000-00000000000b';
const SHOP_LAPSED = '03000000-0000-4000-8000-00000000000c';
const SHOP_BLOCKED = '03000000-0000-4000-8000-00000000000d';
const SHOP_MISSING = '03000000-0000-4000-8000-0000000000ff';

const PERIOD_PRO_LIVE = '04000000-0000-4000-8000-000000000001';
const PERIOD_PRO_PAST = '04000000-0000-4000-8000-000000000002';
const PERIOD_LAPSED = '04000000-0000-4000-8000-000000000003';

const LIVE_EXPIRY = new Date('2030-01-01T00:00:00.000Z');
const PAST_EXPIRY = new Date('2020-01-01T00:00:00.000Z');

interface Principal {
  sid: string;
  accountId: string;
  status: 'active' | 'inactive';
  typ?: 'shopkeeper' | 'staff';
}

const PRINCIPALS = new Map<string, Principal>([
  ['tok-free', { sid: 'sid-free', accountId: SHOP_FREE, status: 'active' }],
  ['tok-pro', { sid: 'sid-pro', accountId: SHOP_PRO, status: 'active' }],
  ['tok-lapsed', { sid: 'sid-lapsed', accountId: SHOP_LAPSED, status: 'active' }],
  ['tok-blocked', { sid: 'sid-blocked', accountId: SHOP_BLOCKED, status: 'active' }],
  ['tok-missing', { sid: 'sid-missing', accountId: SHOP_MISSING, status: 'active' }],
  ['tok-inactive', { sid: 'sid-inactive', accountId: SHOP_PRO, status: 'inactive' }],
  ['tok-staff', { sid: 'sid-staff', accountId: SHOP_PRO, status: 'active', typ: 'staff' }],
]);

const verifier: AccessTokenVerifier = {
  verify: (token) => {
    const principal = PRINCIPALS.get(token);
    if (!principal) return Promise.reject(new Error('unknown token'));
    return Promise.resolve({
      sub: principal.accountId,
      typ: principal.typ ?? 'shopkeeper',
      sid: principal.sid,
      sv: 0,
    });
  },
};

function withoutRequestId(headers: Record<string, unknown>): Record<string, unknown> {
  const { 'x-request-id': _requestId, ...rest } = headers;
  return rest;
}

function snapshotOf(principal: Principal): SessionSnapshot {
  return {
    sid: principal.sid,
    accountId: principal.accountId,
    typ: principal.typ ?? 'shopkeeper',
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

describe('A14 /v1/app/me/subscription', () => {
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
    await ownerPool.query(
      `INSERT INTO customers.shopkeepers
         (id, account_id, phone, name, primary_distributor_id, status, created_at)
       VALUES ($1, $1, '09120000001a', 'فروشگاه آزاد', NULL, 'active', now()),
              ($2, $2, '09120000001b', 'فروشگاه حرفه‌ای', NULL, 'active', now()),
              ($3, $3, '09120000001c', 'فروشگاه منقضی', NULL, 'active', now()),
              ($4, $4, '09120000001d', 'فروشگاه مسدود', NULL, 'blocked', now())`,
      [SHOP_FREE, SHOP_PRO, SHOP_LAPSED, SHOP_BLOCKED],
    );
    await ownerPool.query(
      `INSERT INTO membership.subscriptions
         (id, shopkeeper_id, plan, amount, starts_at, expires_at, created_at)
       VALUES ($1, $4, 'pro', 1490000, $6::timestamptz - interval '30 days', $6, now() - interval '30 days'),
              ($2, $4, 'pro', 1490000, $7::timestamptz - interval '30 days', $7, now() - interval '60 days'),
              ($3, $5, 'pro', 1490000, $7::timestamptz - interval '30 days', $7, now() - interval '30 days')`,
      [
        PERIOD_PRO_LIVE,
        PERIOD_PRO_PAST,
        PERIOD_LAPSED,
        SHOP_PRO,
        SHOP_LAPSED,
        LIVE_EXPIRY,
        PAST_EXPIRY,
      ],
    );
    app = await buildApp({
      config: testConfig(),
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

  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const subscription = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me/subscription', headers: headers(token) });
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me', headers: headers(token) });

  it('A14 answers free with no history, the server price and no-store', async () => {
    const response = await subscription('tok-free');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
    expect(response.json()).toEqual({
      plan: 'free',
      primaryDistributorId: null,
      expiresAt: null,
      renewal: false,
      price: 1_490_000,
      history: [],
    });
  });

  it('A14 answers pro with the live expiry and the whole history, newest first', async () => {
    const response = await subscription('tok-pro');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      plan: 'pro',
      expiresAt: LIVE_EXPIRY.toISOString(),
      renewal: true,
      price: 1_490_000,
    });
    expect(body.history.map((row: { id: string }) => row.id)).toEqual([
      PERIOD_PRO_LIVE,
      PERIOD_PRO_PAST,
    ]);
    expect(body.history.map((row: { status: string }) => row.status)).toEqual([
      'active',
      'expired',
    ]);
    expect(body.history[0]).toMatchObject({
      plan: 'pro',
      startsAt: new Date('2029-12-02T00:00:00.000Z').toISOString(),
      expiresAt: LIVE_EXPIRY.toISOString(),
    });
  });

  it('A14 keeps a lapsed period in history but answers free', async () => {
    const response = await subscription('tok-lapsed');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ plan: 'free', expiresAt: null, renewal: false });
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ id: PERIOD_LAPSED, status: 'expired' });
  });

  it('A7 reports the same plan A14 does', async () => {
    const pro = await me('tok-pro');
    expect(pro.statusCode, pro.body).toBe(200);
    expect(pro.json()).toMatchObject({
      plan: 'pro',
      subscriptionExpiresAt: LIVE_EXPIRY.toISOString(),
    });

    const free = await me('tok-free');
    expect(free.json()).toMatchObject({ plan: 'free', subscriptionExpiresAt: null });
  });

  it('A14 treats a blocked shop and a missing shop as the same 404', async () => {
    for (const token of ['tok-blocked', 'tok-missing']) {
      const response = await subscription(token);
      expect(response.statusCode, token).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
  });

  it('A9-1: an authenticated shop gets the catch-all 404 for A34/A35 in prod and staging demo', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const probes = [
      {
        operationId: 'A34',
        method: 'GET' as const,
        route: '/v1/app/payments/:id',
        url: `/v1/app/payments/${id}`,
      },
      {
        operationId: 'A35',
        method: 'POST' as const,
        route: '/v1/app/payments/:id/mock-complete',
        url: `/v1/app/payments/${id}/mock-complete`,
      },
    ];
    const boots = [
      { name: 'production', config: productionApiConfig() },
      {
        name: 'staging demo',
        config: productionApiConfig({
          DEPLOY_ENV: 'staging',
          DEMO_LOGIN_ENABLED: 'true',
          RATE_DEMO_PER_IP_HOUR: '10',
          RATE_DEMO_GLOBAL_DAY: '200',
        }),
      },
    ];
    for (const boot of boots) {
      const mounted = await buildApp({
        config: boot.config,
        healthChecks: [],
        verifier,
        sessionAuthority: authority,
        appDb: appPool,
      });
      try {
        for (const probe of probes) {
          expect(
            mounted.hasRoute({ method: probe.method, url: probe.route }),
            probe.operationId,
          ).toBe(false);
          const headers = { authorization: 'Bearer tok-pro', 'x-request-id': `a9-1-${boot.name}` };
          const unknown = await mounted.inject({
            method: probe.method,
            url: '/v1/app/no-such-route',
            headers,
          });
          const response = await mounted.inject({
            method: probe.method,
            url: probe.url,
            headers,
          });
          expect(response.statusCode, `${boot.name} ${probe.operationId}`).toBe(404);
          expect(response.body).toBe(unknown.body);
          expect(response.json()).toEqual({
            error: { code: 'NOT_FOUND', message: 'Resource not found' },
          });
          expect(withoutRequestId(response.headers)).toEqual(withoutRequestId(unknown.headers));
        }
      } finally {
        await mounted.close();
      }
    }
  });

  it('A14 rejects an inactive account, a staff token and a missing token', async () => {
    const inactive = await subscription('tok-inactive');
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const staff = await subscription('tok-staff');
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

    const anonymous = await app.inject({ method: 'GET', url: '/v1/app/me/subscription' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
  });
});
