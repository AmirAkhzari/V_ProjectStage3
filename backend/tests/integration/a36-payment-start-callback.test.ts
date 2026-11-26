import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type {
  SessionAuthority,
  SessionSnapshot,
} from '../../src/platform/auth/sessionAuthority.js';
import { PRO_MONTHLY_PRICE_TOMAN } from '../../src/modules/membership/domain/plan.js';
import { findPaymentProvider } from '../../src/modules/payment/infra/providers/registry.js';
import { testConfig } from '../helpers/config.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

const SHOP_A = '07000000-0000-4000-8000-00000000000a';
const SHOP_B = '07000000-0000-4000-8000-00000000000b';
const SHOP_D = '07000000-0000-4000-8000-00000000000d';

const KEY_1 = 'a36-start-key-000001';
const KEY_2 = 'a36-start-key-000002';
const KEY_3 = 'a36-start-key-000003';
const KEY_4 = 'a36-start-key-000004';

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

describe('A36 payment start + S3 provider callback', () => {
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
       VALUES ($1, $1, '09120000007a', 'فروشگاه الف', NULL, 'active', now()),
              ($2, $2, '09120000007b', 'فروشگاه ب', NULL, 'active', now()),
              ($3, $3, '09120000007d', 'فروشگاه د', NULL, 'blocked', now())`,
      [SHOP_A, SHOP_B, SHOP_D],
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

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const checkout = (token: string, key: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/app/me/subscription/checkout',
      headers: { ...auth(token), 'idempotency-key': key },
    });
  const start = (token: string, id: string, key = 'a36-request-key-0001') =>
    app.inject({
      method: 'POST',
      url: `/v1/app/payments/${id}/start`,
      headers: { ...auth(token), 'idempotency-key': key },
    });
  const callback = (provider: string, body: unknown): Promise<LightMyRequestResponse> =>
    // A variable payload makes Fastify's inject overloads fall back to the chainable form; the
    // promise form is what the assertion helpers below read.
    app.inject({
      method: 'POST',
      url: `/v1/payments/callback/${provider}`,
      payload: body as Record<string, unknown>,
    }) as unknown as Promise<LightMyRequestResponse>;
  const subscription = (token: string) =>
    app.inject({ method: 'GET', url: '/v1/app/me/subscription', headers: auth(token) });

  const paymentOf = async (id: string) => {
    const found = await ownerPool.query<{
      status: string;
      start_count: number;
      authority: string | null;
      redirect_url: string | null;
      paid_at: Date | null;
    }>(
      `SELECT status, start_count, authority, redirect_url, paid_at
         FROM payment.payments WHERE id = $1`,
      [id],
    );
    return found.rows[0]!;
  };
  const periodsOf = async (shopkeeperId: string) => {
    const found = await ownerPool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM membership.subscriptions WHERE shopkeeper_id = $1`,
      [shopkeeperId],
    );
    return found.rows;
  };
  const newIntent = async (token: string, key: string) => {
    const response = await checkout(token, key);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().paymentId as string;
  };

  it('A36 requires a session and the Idempotency-Key header, and 404s an unknown payment', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: `/v1/app/payments/${randomUUID()}/start`,
      headers: { 'idempotency-key': KEY_1 },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');

    const id = await newIntent('tok-a', KEY_1);
    const missing = await app.inject({
      method: 'POST',
      url: `/v1/app/payments/${id}/start`,
      headers: auth('tok-a'),
    });
    expect(missing.statusCode, missing.body).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    expect(missing.headers['cache-control']).toBe('no-store');

    const unknown = await start('tok-a', randomUUID());
    expect(unknown.statusCode, unknown.body).toBe(404);
    const malformed = await start('tok-a', 'not-a-uuid');
    expect(malformed.statusCode).toBe(404);
    expect((await paymentOf(id)).start_count).toBe(0);
  });

  it('A36 re-uses the stored authority and refuses the fourth attempt', async () => {
    const id = await newIntent('tok-a', KEY_2);
    const first = await start('tok-a', id);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const body = first.json();
    expect(body).toMatchObject({
      paymentId: id,
      amount: PRO_MONTHLY_PRICE_TOMAN,
      status: 'pending',
      attempts: 1,
    });
    expect(body.redirectUrl).toMatch(/^mock:\/\/pay\//);
    expect(body.authority).toBe(`MOCK-${id}`);

    const second = await start('tok-a', id);
    expect(second.json()).toMatchObject({ authority: body.authority, attempts: 2 });
    const third = await start('tok-a', id);
    expect(third.json()).toMatchObject({ authority: body.authority, attempts: 3 });

    const fourth = await start('tok-a', id);
    expect(fourth.statusCode, fourth.body).toBe(409);
    expect(fourth.json()).toMatchObject({ error: { code: 'PAYMENT_NOT_STARTABLE' } });
    // The refused attempt did not move the counter past the contract's cap.
    expect((await paymentOf(id)).start_count).toBe(3);
  });

  it('A36 keeps another shop, staff and inactive sessions out', async () => {
    const id = await newIntent('tok-a', KEY_3);
    expect((await start('tok-a', id)).statusCode).toBe(200);

    const foreign = await start('tok-b', id);
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    expect((await paymentOf(id)).start_count).toBe(1);

    const staff = await start('tok-staff', id);
    expect(staff.statusCode).toBe(401);
    expect(staff.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });

    const inactive = await start('tok-inactive', id);
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    const blocked = await start('tok-d', id);
    expect(blocked.statusCode).toBe(404);
  });

  it('S3 verifies the callback, settles once and grants one Pro period', async () => {
    const id = await newIntent('tok-a', KEY_4);
    const started = await start('tok-a', id);
    expect(started.statusCode, started.body).toBe(200);
    const { authority: paidAuthority } = started.json();
    const periodsBefore = (await periodsOf(SHOP_A)).length;

    const settled = await callback('mock', { authority: paidAuthority, outcome: 'ok' });
    expect(settled.statusCode, settled.body).toBe(200);
    expect(settled.json()).toEqual({ ok: true, paymentId: id, status: 'paid' });

    const row = await paymentOf(id);
    expect(row.status).toBe('paid');
    expect(row.paid_at).not.toBeNull();
    expect((await periodsOf(SHOP_A)).length).toBe(periodsBefore + 1);

    const plan = (await subscription('tok-a')).json();
    expect(plan.plan).toBe('pro');

    // A replayed notification is the same answer and must not buy a second month.
    const replay = await callback('mock', { authority: paidAuthority, outcome: 'ok' });
    expect(replay.json()).toEqual({ ok: true, paymentId: id, status: 'paid' });
    expect((await periodsOf(SHOP_A)).length).toBe(periodsBefore + 1);

    // A paid intent is no longer startable.
    const after = await start('tok-a', id);
    expect(after.statusCode).toBe(409);
    expect(after.json()).toMatchObject({ error: { code: 'PAYMENT_NOT_STARTABLE' } });
  });

  it('S3 fails an intent without a plan, and a failed payment stays failed', async () => {
    const id = await newIntent('tok-b', 'a36-start-key-000005');
    const started = await start('tok-b', id);
    expect(started.statusCode, started.body).toBe(200);
    const { authority: failedAuthority } = started.json();

    const failed = await callback('mock', { authority: failedAuthority, outcome: 'fail' });
    expect(failed.json()).toEqual({ ok: true, paymentId: id, status: 'failed' });
    expect((await periodsOf(SHOP_B)).length).toBe(0);
    expect((await subscription('tok-b')).json()).toMatchObject({ plan: 'free' });

    // A late success cannot resurrect a final failure.
    const late = await callback('mock', { authority: failedAuthority, outcome: 'ok' });
    expect(late.json()).toEqual({ ok: true, paymentId: id, status: 'failed' });
    expect((await periodsOf(SHOP_B)).length).toBe(0);

    const startAgain = await start('tok-b', id);
    expect(startAgain.statusCode).toBe(409);
  });

  it('S3 answers the uniform 404 for an unknown provider or authority and 400 for a bad body', async () => {
    const unknownProvider = await callback('zarinpal', { authority: 'MOCK-x', outcome: 'ok' });
    expect(unknownProvider.statusCode).toBe(404);
    expect(unknownProvider.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });

    const unknownAuthority = await callback('mock', { authority: 'MOCK-nope', outcome: 'ok' });
    expect(unknownAuthority.statusCode).toBe(404);

    for (const body of [
      { authority: 'MOCK-nope' },
      { authority: 'MOCK-nope', outcome: 'maybe' },
      { authority: 'MOCK-nope', outcome: 'ok', amount: 1 },
      { outcome: 'ok' },
    ]) {
      const bad = await callback('mock', body);
      expect(bad.statusCode, JSON.stringify(body)).toBe(400);
      expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('A36 refuses a second start while the provider already holds the money', async () => {
    const id = await newIntent('tok-a', 'a36-start-key-000006');
    const started = await start('tok-a', id);
    expect(started.statusCode, started.body).toBe(200);
    const { authority: heldAuthority } = started.json();

    // The PSP verified this authority out of band; our callback has not landed yet.
    const provider = findPaymentProvider('mock');
    expect(provider).toBeDefined();
    await provider!.verify({ paymentId: id, authority: heldAuthority });

    const again = await start('tok-a', id);
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'PAYMENT_VERIFICATION_PENDING' } });

    // The callback then settles it through the `already_verified` path.
    const settled = await callback('mock', { authority: heldAuthority, outcome: 'ok' });
    expect(settled.json()).toEqual({ ok: true, paymentId: id, status: 'paid' });
    expect((await paymentOf(id)).status).toBe('paid');
  });
});
