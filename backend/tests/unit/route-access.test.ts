import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyPluginAsync, LightMyRequestResponse } from 'fastify';
import { z } from 'zod';
import Fastify from 'fastify';
import { buildApp, type App } from '../../src/app.js';
import { createRouteGroup } from '../../src/http/group.js';
import type { AccessClaims, AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import {
  createRouteRegistry,
  type RouteRegistryRow,
} from '../../src/platform/http/routeRegistry.js';
import type { OtpAuthRuntime } from '../../src/modules/identity/application/otpAuth.js';
import { registerErrorHandling } from '../../src/platform/http/errors.js';
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
    app.post('/auth/password', { schema: { operationId: 'C11' } }, async () => ({ ok: true }));
    app.get('/test/payouts', { schema: { operationId: 'TEST_DRIVER_PROBE' } }, async () => ({
      ok: true,
    }));
    app.get('/test/perm', { schema: { operationId: 'TEST_DRIVER_PERM' } }, async () => ({
      ok: true,
    }));
  },
  rows: [
    {
      operationId: 'TEST_DRIVER_PROBE',
      method: 'GET',
      path: '/v1/driver/test/payouts',
      access: { kind: 'authenticated', subject: 'driver' },
    },
    {
      operationId: 'TEST_DRIVER_PERM',
      method: 'GET',
      path: '/v1/driver/test/perm',
      access: { kind: 'permission', allOf: ['drivers.view'] },
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

describe('slice 1b build-time contract checks', () => {
  it('P3-3: authenticated subject must match the path group', () => {
    expect(() =>
      createRouteRegistry([
        {
          operationId: 'TEST_BAD_SUBJECT',
          method: 'GET',
          path: '/v1/admin/x',
          access: { kind: 'authenticated', subject: 'shopkeeper' },
        },
      ]),
    ).toThrow(/TEST_BAD_SUBJECT/);
    expect(() =>
      createRouteRegistry([
        {
          operationId: 'TEST_NO_GROUP',
          method: 'GET',
          path: '/v1/x',
          access: { kind: 'authenticated', subject: 'shopkeeper' },
        },
      ]),
    ).toThrow(/TEST_NO_GROUP/);
  });

  it('P3-6a/P3-6d: only C11 and B4 may allow must-change-password', () => {
    expect(() =>
      createRouteRegistry([
        {
          operationId: 'C11',
          method: 'POST',
          path: '/v1/driver/auth/password',
          access: { kind: 'authenticated', subject: 'driver', allowMustChangePassword: true },
        },
        {
          operationId: 'B4',
          method: 'POST',
          path: '/v1/admin/auth/logout',
          access: { kind: 'authenticated', subject: 'staff', allowMustChangePassword: true },
        },
      ]),
    ).not.toThrow();
    for (const operationId of ['C3', 'TEST_MCP']) {
      expect(() =>
        createRouteRegistry([
          {
            operationId,
            method: 'POST',
            path: operationId === 'C3' ? '/v1/driver/auth/logout' : '/v1/driver/test/mcp',
            access: { kind: 'authenticated', subject: 'driver', allowMustChangePassword: true },
          },
        ]),
      ).toThrow(new RegExp(operationId));
    }
  });

  it('P3-2b: a non-public row outside an API group is refused at boot', async () => {
    await expect(
      buildApp({
        config: testConfig(),
        healthChecks: [],
        testRegistryRows: [
          {
            operationId: 'TEST_ROOT',
            method: 'GET',
            path: '/test/root',
            access: { kind: 'permission', allOf: ['distributors.view'] },
          },
        ],
      }),
    ).rejects.toThrow(/TEST_ROOT/);
  });
});

describe('P3-4: per-group authentication and authorization', () => {
  const forbidden = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

  it('admin: 401 no token, 401 bad token, 403 wrong permission', async () => {
    const app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('staff'),
      sessionAuthority: allowAllSessionAuthority('staff', { permissions: [] }),
    });
    const url = '/v1/admin/distributors/01000000-0000-4000-8000-000000000001';
    try {
      const noToken = await app.inject({ method: 'GET', url });
      expect(noToken.statusCode).toBe(401);
      expect(noToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      const badToken = await request(app, 'GET', url, {
        headers: { authorization: 'Bearer bad-token' },
      });
      expect(badToken.statusCode).toBe(401);
      expect(badToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      const denied = await request(app, 'GET', url);
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual(forbidden);
    } finally {
      await app.close();
    }
  });

  it('app: 401 no token, 401 bad token, 403 wrong permission', async () => {
    const plugin = createRouteGroup({ group: 'app', prefix: '/v1/app', subject: 'shopkeeper' });
    const isolated = Fastify();
    registerErrorHandling(isolated);
    await isolated.register(plugin, {
      prefix: '/v1/app',
      modules: [],
      verifier: verifierOf('shopkeeper'),
      sessionAuthority: allowAllSessionAuthority('shopkeeper', { permissions: [] }),
      assertIssuance: async () => undefined,
      registry: createRouteRegistry([
        {
          operationId: 'TEST_APP_ME',
          method: 'GET',
          path: '/v1/app/test/me',
          access: { kind: 'authenticated', subject: 'shopkeeper' },
        },
        {
          operationId: 'TEST_APP_PERM',
          method: 'GET',
          path: '/v1/app/test/perm',
          access: { kind: 'permission', allOf: ['distributors.view'] },
        },
      ]),
      extraRoutes: async (probes) => {
        probes.get('/test/me', { schema: { operationId: 'TEST_APP_ME' } }, async () => ({
          ok: true,
        }));
        probes.get('/test/perm', { schema: { operationId: 'TEST_APP_PERM' } }, async () => ({
          ok: true,
        }));
      },
    });
    try {
      const noToken = await isolated.inject({ method: 'GET', url: '/v1/app/test/me' });
      expect(noToken.statusCode).toBe(401);
      expect(noToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      const badToken = await isolated.inject({
        method: 'GET',
        url: '/v1/app/test/me',
        headers: { authorization: 'Bearer bad-token' },
      });
      expect(badToken.statusCode).toBe(401);
      expect(badToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      const denied = await isolated.inject({
        method: 'GET',
        url: '/v1/app/test/perm',
        headers: AUTH,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual(forbidden);
    } finally {
      await isolated.close();
    }
  });

  it('driver: 401 no token, 401 bad token, 403 wrong permission', async () => {
    const app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('driver'),
      sessionAuthority: allowAllSessionAuthority('driver', { permissions: [] }),
      driverTestRoutes: DRIVER_PROBES.plugin,
      testRegistryRows: DRIVER_PROBES.rows,
      assertIssuance: async () => undefined,
    });
    try {
      const noToken = await app.inject({ method: 'GET', url: '/v1/driver/test/me' });
      expect(noToken.statusCode).toBe(401);
      const badToken = await request(app, 'GET', '/v1/driver/test/me', {
        headers: { authorization: 'Bearer bad-token' },
      });
      expect(badToken.statusCode).toBe(401);
      expect(badToken.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
      const denied = await request(app, 'GET', '/v1/driver/test/perm');
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual(forbidden);
    } finally {
      await app.close();
    }
  });

  it('shopkeeper token on /v1/admin and /v1/driver is TOKEN_TYPE_MISMATCH', async () => {
    const app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('shopkeeper'),
      sessionAuthority: allowAllSessionAuthority('shopkeeper'),
    });
    try {
      for (const url of ['/v1/admin/anything', '/v1/driver/anything']) {
        const response = await request(app, 'GET', url);
        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });
      }
    } finally {
      await app.close();
    }
  });

  it('HEAD B25: 401 without a token, 403 without distributors.view', async () => {
    const app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('staff'),
      sessionAuthority: allowAllSessionAuthority('staff', { permissions: [] }),
    });
    const url = '/v1/admin/distributors/01000000-0000-4000-8000-000000000001';
    try {
      const noToken = await app.inject({ method: 'HEAD', url });
      expect(noToken.statusCode).toBe(401);
      const denied = await app.inject({ method: 'HEAD', url, headers: AUTH });
      expect(denied.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('P3-6b: must-change staff logout exception', () => {
  it('POST B4 is 200 while GET B25 is PASSWORD_CHANGE_REQUIRED', async () => {
    const otpAuth = {
      store: { logoutSid: async () => undefined },
    } as unknown as OtpAuthRuntime;
    const app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('staff'),
      sessionAuthority: allowAllSessionAuthority('staff', {
        mustChangePassword: true,
        staffRole: 'distributor_admin',
        permissions: ['distributors.view'],
      }),
      otpAuth,
    });
    try {
      const logout = await app.inject({
        method: 'POST',
        url: '/v1/admin/auth/logout',
        headers: AUTH,
      });
      expect(logout.statusCode).toBe(200);
      const blocked = await request(
        app,
        'GET',
        '/v1/admin/distributors/01000000-0000-4000-8000-000000000001',
      );
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
    } finally {
      await app.close();
    }
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
