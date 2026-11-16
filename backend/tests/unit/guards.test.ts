import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildApp, type App } from '../../src/app.js';
import { createRouteGroup } from '../../src/http/group.js';
import { subjectGuard } from '../../src/platform/auth/guards.js';
import type { AccessClaims, AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import type { SessionAuthority } from '../../src/platform/auth/sessionAuthority.js';
import { createRouteRegistry } from '../../src/platform/http/routeRegistry.js';
import { testConfig } from '../helpers/config.js';
import { allowAllSessionAuthority } from '../helpers/sessionAuthority.js';

const claims = (typ: AccessClaims['typ']): AccessClaims => ({
  sub: 'user-1',
  typ,
  sid: 'sid-1',
  sv: 0,
});

const verifierOf = (typ: AccessClaims['typ']): AccessTokenVerifier => ({
  verify: () => Promise.resolve(claims(typ)),
});

describe('route group guards', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('deny-all verifier rejects a presented bearer token', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/anything',
      headers: { authorization: 'Bearer eyJhbGciOiJub25lIn0.e30.' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects unauthenticated calls to empty /v1/admin namespace', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const response = await app.inject({ method: 'GET', url: '/v1/admin/anything' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects HEAD and OPTIONS on grouped paths without a token', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const head = await app.inject({ method: 'HEAD', url: '/v1/admin/anything' });
    expect(head.statusCode).toBe(401);
    const options = await app.inject({ method: 'OPTIONS', url: '/v1/app/anything' });
    expect(options.statusCode).toBe(401);
    expect(options.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('A-11-3: a verifier without a session authority is rejected at boot', async () => {
    await expect(
      buildApp({
        config: testConfig(),
        healthChecks: [],
        verifier: verifierOf('staff'),
      }),
    ).rejects.toThrow(/sessionAuthority is required/);
  });

  it('A-11-7: issuance inject path fail-closes through Fastify', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const response = await app.inject({ method: 'POST', url: '/v1/driver/auth/login' });
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('R11-5: registry operationId C11 is fresh without a sensitive group', async () => {
    let pgHits = 0;
    const base = allowAllSessionAuthority('driver');
    const authority: SessionAuthority = {
      ...base,
      check: async (sid, sv, opts) => {
        if (opts?.fresh === true) {
          pgHits += 1;
          return { status: 'revoked', reason: 'fresh' };
        }
        return base.check(sid, sv);
      },
    };
    const isolated = Fastify();
    isolated.addHook('onRequest', async function guard(request, reply) {
      return subjectGuard('driver', verifierOf('driver'), { sessionAuthority: authority }).call(
        this,
        request,
        reply,
      );
    });
    isolated.post('/v1/driver/auth/password', { schema: { operationId: 'C11' } }, async () => ({
      ok: true,
    }));
    try {
      const response = await isolated.inject({
        method: 'POST',
        url: '/v1/driver/auth/password',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(response.statusCode).toBe(401);
      expect(pgHits).toBe(1);
    } finally {
      await isolated.close();
    }
  });

  it('A-11-2: sensitive group option always hits PG', async () => {
    let pgHits = 0;
    const base = allowAllSessionAuthority('driver');
    const authority: SessionAuthority = {
      ...base,
      check: async (sid, sv, opts) => {
        if (opts?.fresh === true) {
          pgHits += 1;
          return { status: 'revoked', reason: 'fresh' };
        }
        return base.check(sid, sv);
      },
    };
    const plugin = createRouteGroup({
      group: 'driver',
      prefix: '/v1/driver',
      subject: 'driver',
      sensitive: true,
    });
    const isolated = Fastify();
    await isolated.register(plugin, {
      prefix: '/v1/driver',
      modules: [],
      verifier: verifierOf('driver'),
      sessionAuthority: authority,
      assertIssuance: async () => undefined,
      registry: createRouteRegistry([]),
    });
    try {
      const response = await isolated.inject({
        method: 'GET',
        url: '/v1/driver/payouts',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(response.statusCode).toBe(401);
      expect(pgHits).toBe(1);
    } finally {
      await isolated.close();
    }
  });

  it('rejects a driver token on /v1/admin', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('driver'),
      sessionAuthority: allowAllSessionAuthority('driver'),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/anything',
      headers: { authorization: 'Bearer mock-token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'TOKEN_TYPE_MISMATCH' } });
  });

  it.each([
    { source: 'body' as const, field: 'shopkeeperId' },
    { source: 'body' as const, field: 'driverId' },
    { source: 'body' as const, field: 'distributorId' },
    { source: 'query' as const, field: 'shopkeeperId' },
    { source: 'query' as const, field: 'driverId' },
    { source: 'query' as const, field: 'distributorId' },
  ])('AUTH-JW-04: rejects client-supplied $field in $source', async ({ source, field }) => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('shopkeeper'),
      sessionAuthority: allowAllSessionAuthority('shopkeeper'),
    });
    const response =
      source === 'body'
        ? await app.inject({
            method: 'POST',
            url: '/v1/app/anything',
            headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
            payload: { [field]: 'should-not-be-here' },
          })
        : await app.inject({
            method: 'GET',
            url: '/v1/app/anything',
            headers: { authorization: 'Bearer mock-token' },
            query: { [field]: 'should-not-be-here' },
          });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field } },
    });
  });
});
