import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyPluginAsync, LightMyRequestResponse } from 'fastify';
import { z } from 'zod';
import { buildApp, type App } from '../../src/app.js';
import type { AccessClaims, AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import {
  createRouteRegistry,
  type RouteRegistryRow,
} from '../../src/platform/http/routeRegistry.js';
import { decideRouteAccess } from '../../src/platform/http/routeAccess.js';
import { testConfig } from '../helpers/config.js';
import { allowAllSessionAuthority, type AllowAllOptions } from '../helpers/sessionAuthority.js';

const AUTH = { authorization: 'Bearer good-token' };
const claims = (typ: AccessClaims['typ']): AccessClaims => ({
  sub: 'user-1',
  typ,
  sid: 'sid-1',
  sv: 0,
});
const verifierOf = (typ: AccessClaims['typ']): AccessTokenVerifier => ({
  verify: (token) =>
    token === 'good-token' ? Promise.resolve(claims(typ)) : Promise.reject(new Error('bad token')),
});
interface Extra {
  headers?: Record<string, string>;
  payload?: object;
  auth?: boolean;
}

async function request(
  app: App,
  method: 'GET' | 'POST',
  url: string,
  extra: Extra = {},
): Promise<LightMyRequestResponse> {
  const headers = { ...(extra.auth === false ? {} : AUTH), ...(extra.headers ?? {}) };
  return extra.payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload: extra.payload });
}

const PROBES: { plugin: FastifyPluginAsync; rows: readonly RouteRegistryRow[] } = {
  plugin: async (app) => {
    app.get('/test/sa-only', { schema: { operationId: 'TEST_SA_ONLY' } }, async () => ({
      ok: true,
    }));
    app.get('/test/perm', { schema: { operationId: 'TEST_PERM' } }, async () => ({ ok: true }));
    app.post(
      '/test/protected',
      {
        schema: {
          operationId: 'TEST_PROTECTED',
          body: z.object({ name: z.string().min(3) }).strict(),
        },
      },
      async () => ({ ok: true }),
    );
  },
  rows: [
    {
      operationId: 'TEST_SA_ONLY',
      method: 'GET',
      path: '/v1/admin/test/sa-only',
      access: { kind: 'role', role: 'super_admin' },
    },
    {
      operationId: 'TEST_PERM',
      method: 'GET',
      path: '/v1/admin/test/perm',
      access: { kind: 'permission', anyOf: ['staff.manage'] },
    },
    {
      operationId: 'TEST_PROTECTED',
      method: 'POST',
      path: '/v1/admin/test/protected',
      access: { kind: 'permission', allOf: ['distributors.view'] },
    },
  ],
};

const DRIVER_PROBES: { plugin: FastifyPluginAsync; rows: readonly RouteRegistryRow[] } = {
  plugin: async (app) => {
    app.post('/auth/password', { schema: { operationId: 'TEST_C11' } }, async () => ({ ok: true }));
    app.get('/test/payouts', { schema: { operationId: 'TEST_DRIVER_PROBE' } }, async () => ({
      ok: true,
    }));
  },
  rows: [
    {
      operationId: 'TEST_C11',
      method: 'POST',
      path: '/v1/driver/auth/password',
      access: { kind: 'authenticated', subject: 'driver', allowMustChangePassword: true },
    },
    {
      operationId: 'TEST_DRIVER_PROBE',
      method: 'GET',
      path: '/v1/driver/test/payouts',
      access: { kind: 'authenticated', subject: 'driver' },
    },
  ],
};

function staffApp(options: AllowAllOptions, logDestination?: Writable): Promise<App> {
  return buildApp({
    config: testConfig(),
    healthChecks: [],
    verifier: verifierOf('staff'),
    sessionAuthority: allowAllSessionAuthority('staff', options),
    adminTestRoutes: PROBES.plugin,
    testRegistryRows: PROBES.rows,
    ...(logDestination ? { logDestination } : {}),
  });
}

describe('default-deny route registry (build time)', () => {
  it('throws when a probe has no registry row, naming the operationId', async () => {
    const unmapped: FastifyPluginAsync = async (app) => {
      app.get('/test/unmapped', { schema: { operationId: 'TEST_UNMAPPED' } }, async () => ({
        ok: true,
      }));
    };
    await expect(
      buildApp({ config: testConfig(), healthChecks: [], adminTestRoutes: unmapped }),
    ).rejects.toThrow(/TEST_UNMAPPED/);
  });

  it('throws when a grouped route has no operationId, naming method and path', async () => {
    const noId: FastifyPluginAsync = async (app) => {
      app.get('/test/no-operation-id', async () => ({ ok: true }));
    };
    await expect(
      buildApp({ config: testConfig(), healthChecks: [], adminTestRoutes: noId }),
    ).rejects.toThrow(/GET \/v1\/admin\/test\/no-operation-id/);
  });

  it('refuses duplicate ids/routes and a method that does not match the row', async () => {
    expect(() =>
      createRouteRegistry([
        { operationId: 'X1', method: 'GET', path: '/v1/x/{id}', access: { kind: 'public' } },
        { operationId: 'X1', method: 'GET', path: '/v1/y', access: { kind: 'public' } },
      ]),
    ).toThrow(/duplicate operationId X1/);
    expect(() =>
      createRouteRegistry([
        { operationId: 'X1', method: 'GET', path: '/v1/x', access: { kind: 'public' } },
        { operationId: 'X2', method: 'GET', path: '/v1/x', access: { kind: 'public' } },
      ]),
    ).toThrow(/duplicate route GET \/v1\/x/);
    const wrongMethod: FastifyPluginAsync = async (app) => {
      app.post('/test/sa-only', { schema: { operationId: 'TEST_SA_ONLY' } }, async () => ({
        ok: true,
      }));
    };
    await expect(
      buildApp({
        config: testConfig(),
        healthChecks: [],
        adminTestRoutes: wrongMethod,
        testRegistryRows: PROBES.rows,
      }),
    ).rejects.toThrow(/TEST_SA_ONLY registered as POST/);
  });

  it('A-3-1: throws for a permission row with no usable anyOf/allOf codes', () => {
    const malformed: RouteRegistryRow[] = [
      {
        operationId: 'TEST_NO_RULE',
        method: 'GET',
        path: '/v1/x1',
        access: { kind: 'permission' },
      },
      {
        operationId: 'TEST_EMPTY_ANY',
        method: 'GET',
        path: '/v1/x2',
        access: { kind: 'permission', anyOf: [] },
      },
      {
        operationId: 'TEST_EMPTY_ALL',
        method: 'GET',
        path: '/v1/x3',
        access: { kind: 'permission', allOf: [] },
      },
    ];
    for (const malformedRow of malformed) {
      expect(() => createRouteRegistry([malformedRow])).toThrow(
        new RegExp(malformedRow.operationId),
      );
    }
  });
});

describe('decideRouteAccess', () => {
  const row = (access: RouteRegistryRow['access']): RouteRegistryRow => ({
    operationId: 'X',
    method: 'GET',
    path: '/x',
    access,
  });
  const principal = (overrides: Partial<Parameters<typeof decideRouteAccess>[1]> = {}) => ({
    permissions: [] as readonly string[],
    staffRole: null,
    mustChangePassword: false,
    ...overrides,
  });

  it('fails closed when the row is missing', () => {
    expect(decideRouteAccess(undefined, principal())).toEqual({
      allow: false,
      reason: 'unmapped_route',
      code: 'FORBIDDEN',
    });
  });

  it('requires anyOf codes and all allOf codes', () => {
    const anyOf = row({ kind: 'permission', anyOf: ['staff.manage', 'audit.view'] });
    expect(decideRouteAccess(anyOf, principal({ permissions: ['audit.view'] })).allow).toBe(true);
    expect(decideRouteAccess(anyOf, principal())).toMatchObject({
      allow: false,
      reason: 'missing_permission',
    });
    const allOf = row({ kind: 'permission', allOf: ['distributors.view', 'distributors.manage'] });
    expect(decideRouteAccess(allOf, principal({ permissions: ['distributors.view'] })).allow).toBe(
      false,
    );
    expect(
      decideRouteAccess(
        allOf,
        principal({ permissions: ['distributors.view', 'distributors.manage'] }),
      ).allow,
    ).toBe(true);
  });

  it('A-3-1: malformed permission rules deny even when the principal has permissions', () => {
    const granted = principal({ permissions: ['staff.manage', 'distributors.view'] });
    const malformed: RouteRegistryRow['access'][] = [
      { kind: 'permission' },
      { kind: 'permission', anyOf: [] },
      { kind: 'permission', allOf: [] },
    ];
    for (const access of malformed) {
      expect(decideRouteAccess(row(access), granted)).toEqual({
        allow: false,
        reason: 'missing_permission',
        code: 'FORBIDDEN',
      });
    }
  });

  it('L-3-2: a B4-shaped staff row allows a must-change principal', () => {
    const b4 = row({ kind: 'authenticated', subject: 'staff', allowMustChangePassword: true });
    expect(decideRouteAccess(b4, principal({ mustChangePassword: true })).allow).toBe(true);
  });

  it('super_admin passes the role rule with no permission codes', () => {
    const sa = row({ kind: 'role', role: 'super_admin' });
    expect(decideRouteAccess(sa, principal({ staffRole: 'super_admin' })).allow).toBe(true);
    expect(decideRouteAccess(sa, principal({ staffRole: 'distributor_admin' }))).toMatchObject({
      allow: false,
      reason: 'not_super_admin',
    });
  });

  it('must_change_password blocks every row except the C11 exception', () => {
    const locked = principal({ mustChangePassword: true, permissions: ['distributors.view'] });
    expect(
      decideRouteAccess(row({ kind: 'permission', allOf: ['distributors.view'] }), locked),
    ).toMatchObject({ allow: false, code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(decideRouteAccess(row({ kind: 'authenticated', subject: 'driver' }), locked).allow).toBe(
      false,
    );
    expect(
      decideRouteAccess(
        row({ kind: 'authenticated', subject: 'driver', allowMustChangePassword: true }),
        locked,
      ).allow,
    ).toBe(true);
    expect(decideRouteAccess(row({ kind: 'public' }), locked).allow).toBe(true);
  });
});

describe('onRequest access enforcement', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('401 without a token and 401 with a rejected token', async () => {
    app = await staffApp({ permissions: ['distributors.view'] });
    const noToken = await request(app, 'GET', '/v1/admin/test/sa-only', { auth: false });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    const badToken = await request(app, 'GET', '/v1/admin/test/sa-only', {
      headers: { authorization: 'Bearer bad-token' },
    });
    expect(badToken.statusCode).toBe(401);
    expect(badToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('V11-PERM-01: a DA without the code gets 403; super_admin role passes', async () => {
    app = await staffApp({ permissions: [], staffRole: 'distributor_admin' });
    const denied = await request(app, 'GET', '/v1/admin/test/sa-only');
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    await app.close();
    app = await staffApp({ permissions: [], staffRole: 'super_admin' });
    const allowed = await request(app, 'GET', '/v1/admin/test/sa-only');
    expect(allowed.statusCode).toBe(200);
  });

  it('uses the snapshot for anyOf and ignores client-supplied permissions', async () => {
    app = await staffApp({ permissions: ['staff.manage'], staffRole: 'distributor_admin' });
    const allowed = await request(app, 'GET', '/v1/admin/test/perm');
    expect(allowed.statusCode).toBe(200);
    await app.close();
    app = await staffApp({ permissions: [], staffRole: 'distributor_admin' });
    const header = await request(app, 'GET', '/v1/admin/test/sa-only', {
      headers: { 'x-permission': 'staff.manage' },
    });
    expect(header.statusCode).toBe(403);
    const query = await request(app, 'GET', '/v1/admin/test/sa-only?permissions=staff.manage');
    expect(query.statusCode).toBe(403);
    const body = await request(app, 'POST', '/v1/admin/test/protected', {
      headers: { 'content-type': 'application/json' },
      payload: {
        name: 'valid-name',
        permissions: ['distributors.view'],
        staffRole: 'super_admin',
      },
    });
    expect(body.statusCode).toBe(403);
  });

  it('B25: a DA without distributors.view gets 403, not 404', async () => {
    app = await staffApp({ permissions: [] });
    const response = await request(
      app,
      'GET',
      '/v1/admin/distributors/01000000-0000-4000-8000-000000000001',
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('auth runs before validation: unauthenticated bad body is 401, not 422', async () => {
    app = await staffApp({ permissions: ['distributors.view'] });
    const response = await request(app, 'POST', '/v1/admin/test/protected', {
      auth: false,
      headers: { 'content-type': 'application/json' },
      payload: { name: 42 } as unknown as object,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('cross-subject token on the admin probe stays 401 TOKEN_TYPE_MISMATCH', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: { verify: () => Promise.resolve(claims('driver')) },
      sessionAuthority: allowAllSessionAuthority('driver'),
      adminTestRoutes: PROBES.plugin,
      testRegistryRows: PROBES.rows,
    });
    const response = await request(app, 'GET', '/v1/admin/test/sa-only');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });
  });

  it('the group catch-all stays a 404 after authentication', async () => {
    app = await staffApp({ permissions: ['distributors.view'] });
    const response = await request(app, 'GET', '/v1/admin/not-a-route');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });
});

describe('must_change_password (C11 exception)', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('blocks a driver non-C11 probe but allows the C11-shaped probe', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('driver'),
      sessionAuthority: allowAllSessionAuthority('driver', { mustChangePassword: true }),
      driverTestRoutes: DRIVER_PROBES.plugin,
      testRegistryRows: DRIVER_PROBES.rows,
      assertIssuance: async () => undefined,
    });
    const blocked = await request(app, 'GET', '/v1/driver/test/payouts');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
    const allowed = await request(app, 'POST', '/v1/driver/auth/password');
    expect(allowed.statusCode).toBe(200);
  });
});

describe('deny logging', () => {
  it('logs request id, operation id and reason without token, OTP, phone or body', async () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const app = await buildApp({
      config: testConfig({ LOG_LEVEL: 'info' }),
      healthChecks: [],
      logDestination: destination,
      verifier: verifierOf('staff'),
      sessionAuthority: allowAllSessionAuthority('staff', { permissions: [] }),
      adminTestRoutes: PROBES.plugin,
      testRegistryRows: PROBES.rows,
    });
    try {
      const response = await request(app, 'POST', '/v1/admin/test/protected', {
        headers: { 'content-type': 'application/json' },
        payload: { name: 'valid-name', phone: '09121234567', otp: '123456', token: 'leaky-token' },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
    expect(output).toContain('route_access_denied');
    expect(output).toContain('missing_permission');
    expect(output).toContain('TEST_PROTECTED');
    expect(output).not.toContain('good-token');
    expect(output).not.toContain('09121234567');
    expect(output).not.toContain('123456');
    expect(output).not.toContain('leaky-token');
  });
});
