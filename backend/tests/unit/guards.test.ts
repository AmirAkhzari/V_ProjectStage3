import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import type { AccessClaims, AccessTokenVerifier } from '../../src/platform/auth/jwt.js';
import { testConfig } from '../helpers/config.js';

const claims = (typ: AccessClaims['typ']): AccessClaims => ({
  sub: 'user-1',
  typ,
  sid: 'sid-1',
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

  it('rejects a driver token on /v1/admin', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('driver'),
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
