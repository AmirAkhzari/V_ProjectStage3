import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { testConfig } from '../helpers/config.js';

describe('error-envelope uniformity (not TEN-404-01)', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns identical 404 bodies for unknown ungrouped paths except request id', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const a = await app.inject({ method: 'GET', url: '/no-such-resource-aaaa' });
    const b = await app.inject({ method: 'GET', url: '/no-such-resource-bbbb' });
    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(a.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    expect(b.json()).toEqual(a.json());
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    expect(a.statusCode).not.toBe(403);
  });

  it('returns identical 401 bodies for unknown grouped paths and never 403', async () => {
    app = await buildApp({ config: testConfig(), healthChecks: [] });
    const a = await app.inject({
      method: 'GET',
      url: '/v1/admin/11111111-1111-1111-1111-111111111111',
    });
    const b = await app.inject({
      method: 'GET',
      url: '/v1/admin/99999999-9999-9999-9999-999999999999',
    });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
    expect(a.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(a.statusCode).not.toBe(403);
    expect(b.statusCode).not.toBe(403);
  });
});
