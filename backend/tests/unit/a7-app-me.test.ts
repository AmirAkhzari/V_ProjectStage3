import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { EddsaAccessTokenService, generateEd25519Key } from '../../src/platform/auth/eddsa.js';
import type { AccessClaims, AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type { SessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import {
  assertRouteRegistered,
  catchAllRouteConfig,
  createRouteRegistry,
  isCatchAllRoute,
} from '../../src/platform/http/routeRegistry.js';
import { testConfig } from '../helpers/config.js';
import { allowAllSessionAuthority } from '../helpers/sessionAuthority.js';

const ACCOUNT_ID = '01000000-0000-4000-8000-0000000000a1';
const AUTH = { authorization: 'Bearer good-token' };
const PHONE = '09121234567';

interface Row {
  id: string;
  phone: string;
  primary_distributor_id: string | null;
  status: string;
}
const row = (overrides: Partial<Row> = {}): Row => ({
  id: ACCOUNT_ID,
  phone: PHONE,
  primary_distributor_id: null,
  status: 'active',
  ...overrides,
});

/** Minimal pg.Pool stub: withTenant only needs connect + query + release. */
function poolOf(result: readonly Row[]): pg.Pool {
  const client = {
    query: async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SELECT')) {
        return sql.startsWith('SELECT') ? { rows: result } : { rows: [] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { connect: async () => client } as unknown as pg.Pool;
}

const claims = (overrides: Partial<AccessClaims> = {}): AccessClaims => ({
  sub: ACCOUNT_ID,
  typ: 'shopkeeper',
  sid: 'sid-1',
  sv: 0,
  ...overrides,
});

const verifier: AccessTokenVerifier = {
  verify: (token) => {
    if (token === 'good-token') return Promise.resolve(claims());
    if (token === 'staff-token') return Promise.resolve(claims({ typ: 'staff' }));
    if (token === 'driver-token') return Promise.resolve(claims({ typ: 'driver' }));
    return Promise.reject(new Error('bad token'));
  },
};

const baseAuthority = allowAllSessionAuthority('shopkeeper', { accountId: ACCOUNT_ID });
const authority: SessionAuthority = {
  ...baseAuthority,
  check: (sid, sv, options) =>
    sid === 'sid-revoked'
      ? Promise.resolve({ status: 'revoked', reason: 'revoked' })
      : baseAuthority.check(sid, sv, options),
};

function appOf(rows: readonly Row[]): Promise<App> {
  return buildApp({
    config: testConfig(),
    healthChecks: [],
    verifier,
    sessionAuthority: authority,
    appDb: poolOf(rows),
  });
}

function appMe(app: App, method: 'GET' | 'HEAD' = 'GET', headers: Record<string, string> = AUTH) {
  return app.inject({ method, url: '/v1/app/me', headers });
}

describe('A7 GET /v1/app/me', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('A7-401: no token, bad token and revoked session are 401', async () => {
    app = await appOf([row()]);
    for (const headers of [{}, { authorization: 'Bearer bad-token' }]) {
      const response = await appMe(app, 'GET', headers);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
    const noToken = await appMe(app, 'GET', {});
    expect(noToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    const badToken = await appMe(app, 'GET', { authorization: 'Bearer bad-token' });
    expect(badToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('A7-401: an expired token is 401 UNAUTHENTICATED', async () => {
    const key = await generateEd25519Key('k1');
    const issuedAt = new Date('2026-11-16T12:00:00.000Z');
    const signer = new EddsaAccessTokenService({
      iss: 'vproject',
      activeKid: 'k1',
      keys: [key],
      now: () => issuedAt,
    });
    const expiredToken = await signer.sign({
      sub: ACCOUNT_ID,
      typ: 'shopkeeper',
      sid: 'sid-1',
      sv: 0,
    });
    // 20 minutes after issuance: past the 15-minute TTL plus the 60-second clock skew.
    const later = new Date(issuedAt.getTime() + 20 * 60 * 1000);
    const expiredApp = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: new EddsaAccessTokenService({
        iss: 'vproject',
        activeKid: 'k1',
        keys: [key],
        now: () => later,
      }),
      sessionAuthority: authority,
      appDb: poolOf([row()]),
    });
    try {
      const response = await expiredApp.inject({
        method: 'GET',
        url: '/v1/app/me',
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await expiredApp.close();
    }
  });

  it('A7-401: revoked session is 401 SESSION_REVOKED', async () => {
    app = await appOf([row()]);
    const revokedVerifier: AccessTokenVerifier = {
      verify: () => Promise.resolve(claims({ sid: 'sid-revoked' })),
    };
    const revokedApp = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: revokedVerifier,
      sessionAuthority: authority,
      appDb: poolOf([row()]),
    });
    try {
      const revoked = await revokedApp.inject({
        method: 'GET',
        url: '/v1/app/me',
        headers: AUTH,
      });
      expect(revoked.statusCode).toBe(401);
      expect(revoked.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
    } finally {
      await revokedApp.close();
    }
  });

  it('A7-401: staff and driver tokens are TOKEN_TYPE_MISMATCH', async () => {
    app = await appOf([row()]);
    for (const token of ['staff-token', 'driver-token']) {
      const response = await appMe(app, 'GET', { authorization: `Bearer ${token}` });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });
    }
  });

  it('A7-200: exact key set with documented nulls and no extra fields', async () => {
    app = await appOf([row()]);
    const response = await appMe(app);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(
      ['defaultAddressId', 'plan', 'primaryDistributorId', 'subscriptionExpiresAt', 'user'].sort(),
    );
    expect(Object.keys(body.user).sort()).toEqual(['id', 'name', 'phone']);
    expect(body).toEqual({
      user: { id: ACCOUNT_ID, name: null, phone: PHONE },
      defaultAddressId: null,
      plan: null,
      primaryDistributorId: null,
      subscriptionExpiresAt: null,
    });
  });

  it('A7-404: no shopkeeper row and a non-active row are both NOT_FOUND', async () => {
    for (const rows of [[], [row({ status: 'blocked' })]]) {
      app = await appOf(rows);
      const response = await appMe(app);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
      await app.close();
      app = undefined;
    }
  });

  it('A7-PII: Cache-Control no-store on 200 and 401, no ETag', async () => {
    app = await appOf([row()]);
    const ok = await appMe(app);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.headers.etag).toBeUndefined();
    const denied = await appMe(app, 'GET', {});
    expect(denied.statusCode).toBe(401);
    expect(denied.headers['cache-control']).toBe('no-store');
    const missing = await appMe(app, 'GET', { authorization: 'Bearer staff-token' });
    expect(missing.headers['cache-control']).toBe('no-store');
  });

  it('A7-HEAD: matches GET for 401 and 200', async () => {
    app = await appOf([row()]);
    const get401 = await appMe(app, 'GET', {});
    const head401 = await appMe(app, 'HEAD', {});
    expect(head401.statusCode).toBe(get401.statusCode);
    expect(head401.headers['cache-control']).toBe('no-store');
    const get200 = await appMe(app);
    const head200 = await appMe(app, 'HEAD');
    expect(head200.statusCode).toBe(get200.statusCode);
    expect(head200.headers['cache-control']).toBe('no-store');
  });

  it('A7-SCOPE: X-Scope-Distributor does not change which row is returned', async () => {
    app = await appOf([row()]);
    const plain = await appMe(app);
    const scoped = await appMe(app, 'GET', {
      ...AUTH,
      'x-scope-distributor': '01000000-0000-4000-8000-0000000000ff',
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toEqual(plain.json());
  });

  it('A7-503: missing app-role pool fails closed', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier,
      sessionAuthority: authority,
    });
    const response = await appMe(app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('A7 is not on the must-change-password allowlist', async () => {
    // The registry build itself refuses the flag; C11/B4 remain the only exceptions.
    expect(() =>
      createRouteRegistry([
        {
          operationId: 'A7',
          method: 'GET',
          path: '/v1/app/me',
          access: {
            kind: 'authenticated',
            subject: 'shopkeeper',
            allowMustChangePassword: true,
          },
        },
      ]),
    ).toThrow(/A7/);
  });
});

describe('P4-2 / L-4-1 catch-all marker', () => {
  const registry = createRouteRegistry([]);

  it('skips only with the private marker AND an exact infra path', () => {
    for (const path of ['/v1/app/*', '/v1/admin/*', '/v1/driver/*']) {
      expect(isCatchAllRoute(catchAllRouteConfig().config, path)).toBe(true);
      expect(() =>
        assertRouteRegistered({ method: 'GET', url: path, ...catchAllRouteConfig() }, registry),
      ).not.toThrow();
    }
    // Marker alone is not enough.
    expect(isCatchAllRoute(catchAllRouteConfig().config, '/v1/app/me')).toBe(false);
    expect(() =>
      assertRouteRegistered(
        { method: 'GET', url: '/v1/app/other', ...catchAllRouteConfig() },
        registry,
      ),
    ).toThrow(/without an operationId/);
    // An infra path alone is not enough.
    expect(isCatchAllRoute({}, '/v1/app/*')).toBe(false);
    expect(() =>
      assertRouteRegistered({ method: 'GET', url: '/v1/app/*', config: {} }, registry),
    ).toThrow(/without an operationId/);
  });
});
