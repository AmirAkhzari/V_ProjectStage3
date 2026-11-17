import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import type { DriverAuthRuntime } from '../../src/modules/identity/application/driverAuth.js';
import { passwordChangeKey } from '../../src/modules/identity/application/loginLimiter.js';
import {
  BREACHED_LIST_SHA256,
  BREACHED_LIST_VERSION,
  loadBreachedPasswordList,
  logBreachedListBoot,
} from '../../src/modules/identity/infra/crypto/breachedPasswords.js';
import { BREACHED_LIST_BODY } from '../../src/modules/identity/infra/crypto/breachedPasswordsData.js';
import { testConfig } from '../helpers/config.js';
import { allowAllSessionAuthority } from '../helpers/sessionAuthority.js';

const ACCOUNT_ID = '01000000-0000-4000-8000-0000000000c1';
const DISTRIBUTOR_ID = '01000000-0000-4000-8000-0000000000d1';
const USERNAME = 'drv-aaaa';
const CURRENT = 'pw-cur-aaaaaa';
const NEW = 'pw-new-bbbbbbbb';

/** Counters only: enough to tell RESERVE_ATTEMPT from INCR_EXPIRE. */
class FakeRedis {
  status = 'ready';
  readonly counters = new Map<string, number>();
  async ping() {
    return 'PONG';
  }
  async ttl() {
    return 900;
  }
  async eval(script: string, _n: number, ...args: unknown[]) {
    if (script.includes('local uip_lock')) return [1, 0, 0, 1, 1, 1];
    if (script.includes("local n = redis.call('INCR', KEYS[1])")) {
      const key = String(args[0]);
      const next = (this.counters.get(key) ?? 0) + 1;
      this.counters.set(key, next);
      return next;
    }
    return 1;
  }
}
function fakePool(tempExpiresAt?: Date | null): pg.Pool {
  const query = async (sql: string) => {
    if (sql.includes('lookup_account_scope')) return { rows: [{ distributor_id: DISTRIBUTOR_ID }] };
    if (sql.includes('FROM identity.accounts a')) {
      return {
        rows: [
          {
            username_norm: USERNAME,
            password_hash: 'argon2id$fake$current',
            temp_expires_at: tempExpiresAt ?? null,
            created_at: new Date(),
          },
        ],
      };
    }
    return { rows: [] };
  };
  const client = { query, release: () => undefined };
  return { query, connect: async () => client } as unknown as pg.Pool;
}

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function harness(
  options: {
    typ?: 'driver' | 'staff' | 'shopkeeper';
    redis?: FakeRedis;
    verifyResult?: boolean;
    tempExpiresAt?: Date | null;
  } = {},
): Promise<{ verified: () => number }> {
  const redis = options.redis ?? new FakeRedis();
  let verified = 0;
  const typ = options.typ ?? 'driver';
  const runtime = {
    identityPool: fakePool(options.tempExpiresAt),
    redis,
    jwt: { sign: async () => 'new-access-token' },
    authority: allowAllSessionAuthority('driver', { accountId: ACCOUNT_ID }),
    store: { issue: async () => Promise.reject(new Error('not reached')) },
    hasher: {
      hash: async () => 'argon2id$fake$new',
      verify: async () => {
        verified += 1;
        return options.verifyResult ?? true;
      },
    },
    log: { error: () => undefined },
    auditHashKey: 'test-audit-key',
    breachedPassword: (normalized: string) => normalized === 'password123',
  } as unknown as DriverAuthRuntime;
  app = await buildApp({
    config: testConfig(),
    healthChecks: [],
    verifier: { verify: async () => ({ sub: ACCOUNT_ID, typ, sid: 'sid-1', sv: 0 }) },
    sessionAuthority: allowAllSessionAuthority(typ, { accountId: ACCOUNT_ID }),
    driverAuth: runtime,
    assertIssuance: async () => undefined,
  });
  return { verified: () => verified };
}
const change = (payload: object) =>
  app!.inject({
    method: 'POST',
    url: '/v1/driver/auth/password',
    headers: { authorization: 'Bearer tok' },
    payload,
  });
describe('C11 breach list boot', () => {
  it('P6-4/P6-8: loads the embedded offline list and logs version + pinned sha256', () => {
    const lines: Record<string, unknown>[] = [];
    const list = loadBreachedPasswordList();
    logBreachedListBoot({ info: (bindings) => lines.push(bindings) }, list);
    expect(BREACHED_LIST_VERSION).toBe('2026-10-15.1');
    expect(BREACHED_LIST_SHA256).toBe(
      '510841f72880b13988200c81408f928c617559b3bb25ed900a9d2d3678a368dc',
    );
    expect(list.has('password123')).toBe(true);
    expect(list).toMatchObject({ version: BREACHED_LIST_VERSION, sha256: BREACHED_LIST_SHA256 });
    expect(lines[0]).toMatchObject({
      breachedListVersion: BREACHED_LIST_VERSION,
      breachedListSha256: BREACHED_LIST_SHA256,
    });
  });

  it('P6-8: embedded body and the human-readable .txt copy cannot drift', () => {
    const fileBody = readFileSync(
      new URL('../../src/modules/identity/infra/crypto/breached-passwords.txt', import.meta.url),
    );
    const sha = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex');
    expect(sha(BREACHED_LIST_BODY)).toBe(BREACHED_LIST_SHA256);
    expect(sha(fileBody)).toBe(BREACHED_LIST_SHA256);
  });
});

describe('C11 POST /v1/driver/auth/password', () => {
  const cases: [string, object, number, string][] = [
    [
      '7-char new password',
      { currentPassword: CURRENT, newPassword: 'abc1234' },
      422,
      'PASSWORD_TOO_SHORT',
    ],
    [
      'reuse of current/temp',
      { currentPassword: CURRENT, newPassword: CURRENT },
      422,
      'PASSWORD_REUSED',
    ],
    [
      'offline-list password',
      { currentPassword: CURRENT, newPassword: 'password123' },
      422,
      'PASSWORD_BREACHED',
    ],
    [
      'contains the username',
      { currentPassword: CURRENT, newPassword: `xx${USERNAME}xx` },
      422,
      'PASSWORD_BREACHED',
    ],
    [
      '10 KB body',
      { currentPassword: CURRENT, newPassword: 'a'.repeat(10_000) },
      400,
      'VALIDATION_FAILED',
    ],
    [
      'extra driverId',
      { driverId: DISTRIBUTOR_ID, currentPassword: CURRENT, newPassword: NEW },
      400,
      'VALIDATION_FAILED',
    ],
  ];
  for (const [name, body, status, code] of cases) {
    it(name, async () => {
      const h = await harness();
      const response = await change(body);
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json()).toMatchObject({ error: { code } });
      expect(response.headers['cache-control']).toBe('no-store');
      // Body validation happens before the handler; policy checks run after argon2.
      expect(h.verified()).toBe(status === 400 ? 0 : 1);
    });
  }
  it('wrong current password is 422 CURRENT_PASSWORD_INVALID, not 401', async () => {
    await harness({ verifyResult: false });
    const response = await change({ currentPassword: 'pw-wrong-cccccc', newPassword: NEW });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'CURRENT_PASSWORD_INVALID' } });
  });

  it('an expired temp credential is 422 CURRENT_PASSWORD_INVALID', async () => {
    await harness({ tempExpiresAt: new Date(Date.now() - 60_000) });
    const response = await change({ currentPassword: CURRENT, newPassword: NEW });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'CURRENT_PASSWORD_INVALID' } });
  });

  it('LIM-C11-01: 6th attempt is 429 too_many_attempts + Retry-After, before argon2', async () => {
    const redis = new FakeRedis();
    redis.counters.set(passwordChangeKey(ACCOUNT_ID), 5);
    const h = await harness({ redis });
    const response = await change({ currentPassword: CURRENT, newPassword: NEW });
    expect(response.statusCode, response.body).toBe(429);
    expect(response.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    expect(response.headers['retry-after']).toBe('900');
    expect(h.verified()).toBe(0);
  });

  it('prod-safe wiring: no fs read in dist (embedded body only)', () => {
    const source = readFileSync(
      new URL('../../src/modules/identity/infra/crypto/breachedPasswords.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/node:fs|readFileSync/);
  });

  it('staff and shopkeeper tokens on C11 are 401', async () => {
    for (const typ of ['staff', 'shopkeeper'] as const) {
      await harness({ typ });
      const response = await change({ currentPassword: CURRENT, newPassword: NEW });
      expect(response.statusCode).toBe(401);
    }
  });
});
