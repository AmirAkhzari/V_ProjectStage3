import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type {
  SessionAuthority,
  SessionSnapshot,
} from '../../src/platform/auth/sessionAuthority.js';
import { PRO_MONTHLY_PRICE_TOMAN } from '../../src/modules/membership/domain/plan.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const SHOP_A = '06000000-0000-4000-8000-00000000000a';
const SHOP_B = '06000000-0000-4000-8000-00000000000b';
const SHOP_D = '06000000-0000-4000-8000-00000000000d';
const SHOP_MISSING = '06000000-0000-4000-8000-0000000000ff';

const KEY_A = 'a15-checkout-key-0001';
const KEY_B = 'a15-checkout-key-0002';
const KEY_C = 'a15-checkout-key-0003';

interface Principal {
  sid: string;
  accountId: string;
  status: 'active' | 'inactive';
  typ?: 'shopkeeper' | 'staff';
}

const PRINCIPALS = new Map<string, Principal>([
  ['tok-a', { sid: 'sid-a', accountId: SHOP_A, status: 'active' }],
  ['tok-b', { sid: 'sid-b', accountId: SHOP_B, status: 'active' }],
  ['tok-d', { sid: 'sid-d', accountId: SHOP_D, status: 'active' }],
  ['tok-missing', { sid: 'sid-missing', accountId: SHOP_MISSING, status: 'active' }],
  ['tok-inactive', { sid: 'sid-inactive', accountId: SHOP_A, status: 'inactive' }],
  ['tok-staff', { sid: 'sid-staff', accountId: SHOP_A, status: 'active', typ: 'staff' }],
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

describe('A15/A34/A35 subscription purchase', () => {
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
       VALUES ($1, $1, '09120000006a', 'فروشگاه الف', NULL, 'active', now()),
              ($2, $2, '09120000006b', 'فروشگاه ب', NULL, 'active', now()),
              ($3, $3, '09120000006d', 'فروشگاه د', NULL, 'blocked', now())`,
      [SHOP_A, SHOP_B, SHOP_D],
    );
    // A35 is the demo PSP: it is mounted only where demo login is enabled, like A5/B5.
    app = await buildApp({
      config: testConfig({ DEMO_LOGIN_ENABLED: 'true' }),
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
  const checkout = (token: string, key?: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/app/me/subscription/checkout',
      headers: { ...headers(token), ...(key === undefined ? {} : { 'idempotency-key': key }) },
    });
  const payment = (token: string, id: string) =>
    app.inject({ method: 'GET', url: `/v1/app/payments/${id}`, headers: headers(token) });
  const complete = (token: string, id: string, body?: unknown) =>
    app.inject({
      method: 'POST',
      url: `/v1/app/payments/${id}/mock-complete`,
      headers: headers(token),
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  const subscription = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me/subscription', headers: headers(token) });

  const rowsOf = async (shopkeeperId: string) => {
    const found = await ownerPool.query<{
      id: string;
      status: string;
      amount: string;
      redirect_url: string | null;
    }>(
      `SELECT id::text, status, amount::text, redirect_url
         FROM payment.payments WHERE shopkeeper_id = $1 ORDER BY created_at, id`,
      [shopkeeperId],
    );
    return found.rows;
  };

  const periodsOf = async (shopkeeperId: string) => {
    const found = await ownerPool.query<{ expires_at: Date; amount: string }>(
      `SELECT expires_at, amount::text FROM membership.subscriptions
        WHERE shopkeeper_id = $1 ORDER BY expires_at`,
      [shopkeeperId],
    );
    return found.rows;
  };

  it('A15 requires the Idempotency-Key header and answers 401 without a session', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/v1/app/me/subscription/checkout',
      headers: { 'idempotency-key': KEY_A },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');

    const missing = await checkout('tok-a');
    expect(missing.statusCode, missing.body).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    expect(missing.headers['cache-control']).toBe('no-store');

    for (const key of ['short', 'x'.repeat(129)]) {
      const bad = await checkout('tok-a', key);
      expect(bad.statusCode, key).toBe(400);
      expect(bad.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    }
    expect(await rowsOf(SHOP_A)).toHaveLength(0);
  });

  it('A15 opens a pending intent at the server price and is not cacheable', async () => {
    const response = await checkout('tok-a', KEY_A);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body).toMatchObject({ amount: PRO_MONTHLY_PRICE_TOMAN });
    expect(body.paymentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.redirectUrl).toMatch(/^mock:\/\/pay\//);

    const rows = await rowsOf(SHOP_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.paymentId,
      status: 'pending',
      amount: String(PRO_MONTHLY_PRICE_TOMAN),
      redirect_url: body.redirectUrl,
    });
    expect(await periodsOf(SHOP_A)).toHaveLength(0);
  });

  it('A15 replays the same payment for the same key and opens a new one for a new key', async () => {
    const first = await checkout('tok-a', KEY_A);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().paymentId).toBe((await rowsOf(SHOP_A))[0]!.id);
    expect(await rowsOf(SHOP_A)).toHaveLength(1);

    const second = await checkout('tok-a', KEY_B);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().paymentId).not.toBe(first.json().paymentId);
    expect(await rowsOf(SHOP_A)).toHaveLength(2);
  });

  it("A34 reads only the shop's own payment and never leaks another shop's id", async () => {
    const mine = (await rowsOf(SHOP_A))[0]!;
    const response = await payment('tok-a', mine.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      id: mine.id,
      kind: 'subscription',
      amount: PRO_MONTHLY_PRICE_TOMAN,
      status: 'pending',
    });
    expect(typeof response.json().createdAt).toBe('string');

    for (const id of [mine.id, 'not-a-uuid', randomUUID()]) {
      const other = await payment('tok-b', id);
      expect(other.statusCode, id).toBe(404);
      expect(other.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    }
  });

  it('A35 pays the intent once: paid status, a live Pro period and a Pro plan', async () => {
    const paymentId = (await rowsOf(SHOP_A))[0]!.id;
    const before = Date.now();
    const response = await complete('tok-a', paymentId, { outcome: 'ok' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { plan: 'pro' } });

    expect((await payment('tok-a', paymentId)).json()).toMatchObject({ status: 'paid' });

    const periods = await periodsOf(SHOP_A);
    expect(periods).toHaveLength(1);
    expect(periods[0]!.amount).toBe(String(PRO_MONTHLY_PRICE_TOMAN));
    const expiresAt = periods[0]!.expires_at.getTime();
    // One month from "now", with a day of slack on each side for clock and month length.
    expect(expiresAt).toBeGreaterThan(before + 27 * 24 * 3600 * 1000);
    expect(expiresAt).toBeLessThan(before + 32 * 24 * 3600 * 1000);

    const plan = (await subscription('tok-a')).json();
    expect(plan).toMatchObject({ plan: 'pro', renewal: true });
    expect(plan.expiresAt).toBe(new Date(expiresAt).toISOString());
  });

  it('A35 replays without a second period and keeps the same expiry', async () => {
    const paymentId = (await rowsOf(SHOP_A))[0]!.id;
    const firstExpiry = (await periodsOf(SHOP_A))[0]!.expires_at.toISOString();
    const again = await complete('tok-a', paymentId, { outcome: 'ok' });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual({ ok: true, data: { plan: 'pro' } });
    expect(await periodsOf(SHOP_A)).toHaveLength(1);
    expect((await periodsOf(SHOP_A))[0]!.expires_at.toISOString()).toBe(firstExpiry);

    // The demo PSP's verdict cannot be flipped on an already paid intent.
    const failure = await complete('tok-a', paymentId, { outcome: 'fail' });
    expect(failure.json()).toEqual({ ok: true, data: { plan: 'pro' } });
    expect(await periodsOf(SHOP_A)).toHaveLength(1);
  });

  it('A35 fails an intent without granting a plan, and a failed intent stays failed', async () => {
    const paymentId = (await rowsOf(SHOP_A))[1]!.id;
    const response = await complete('tok-a', paymentId, { outcome: 'fail' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { plan: 'free' } });
    expect((await payment('tok-a', paymentId)).json()).toMatchObject({ status: 'failed' });
    expect(await periodsOf(SHOP_A)).toHaveLength(1);

    const lateOk = await complete('tok-a', paymentId, { outcome: 'ok' });
    expect(lateOk.json()).toEqual({ ok: true, data: { plan: 'free' } });
    expect(await periodsOf(SHOP_A)).toHaveLength(1);
    expect((await payment('tok-a', paymentId)).json()).toMatchObject({ status: 'failed' });
  });

  it('A35 treats an unknown, malformed or foreign payment as the uniform 404', async () => {
    const foreign = (await rowsOf(SHOP_A))[0]!.id;
    for (const id of ['not-a-uuid', randomUUID(), foreign]) {
      const response = await complete('tok-b', id, { outcome: 'ok' });
      expect(response.statusCode, id).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
    // B's failures wrote nothing to A.
    expect((await payment('tok-a', foreign)).json()).toMatchObject({ status: 'paid' });
  });

  it('A35 refuses an unknown outcome and an extra field', async () => {
    const paymentId = (await rowsOf(SHOP_A))[1]!.id;
    for (const body of [{ outcome: 'maybe' }, { outcome: 'ok', plan: 'pro' }, { amount: 1 }]) {
      const response = await complete('tok-a', paymentId, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('A15 treats a blocked or missing shop as 404 and refuses staff and inactive sessions', async () => {
    for (const token of ['tok-d', 'tok-missing']) {
      const response = await checkout(token, KEY_C);
      expect(response.statusCode, token).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    }
    expect(await rowsOf(SHOP_D)).toHaveLength(0);

    const inactive = await checkout('tok-inactive', KEY_C);
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const staff = await checkout('tok-staff', KEY_C);
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });
  });

  it('A35 extends a live plan instead of resetting it when the shop buys again', async () => {
    const firstExpiry = (await periodsOf(SHOP_A))[0]!.expires_at;
    const next = await checkout('tok-a', KEY_C);
    expect(next.statusCode, next.body).toBe(200);
    const paid = await complete('tok-a', next.json().paymentId, { outcome: 'ok' });
    expect(paid.json()).toEqual({ ok: true, data: { plan: 'pro' } });

    const periods = await periodsOf(SHOP_A);
    expect(periods).toHaveLength(2);
    expect(periods[0]!.expires_at.getTime()).toBe(firstExpiry.getTime());
    // The second month starts where the first ends, so the shop does not lose the paid days.
    expect(periods[1]!.expires_at.getTime() - firstExpiry.getTime()).toBeGreaterThan(
      27 * 24 * 3600 * 1000,
    );
  });
});
