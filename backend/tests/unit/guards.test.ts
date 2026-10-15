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

  it('rejects unauthenticated calls to empty /v1/admin namespace', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const response = await app.inject({ method: 'GET', url: '/v1/admin/anything' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
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

  it('rejects client-supplied identity fields', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
      verifier: verifierOf('shopkeeper'),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/app/anything',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      payload: { shopkeeperId: 'should-not-be-here' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
