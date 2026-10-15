import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { productionApiConfig } from '../helpers/config.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };

describe('AUTH-DM-01 demo endpoints in production', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 404 NOT_FOUND for A5/B5 identical to an unknown path', async () => {
    app = await buildApp({ config: productionApiConfig(), healthChecks: [] });
    const unknown = await app.inject({ method: 'POST', url: '/no-such-demo-route' });
    const a5 = await app.inject({ method: 'POST', url: '/v1/app/auth/demo' });
    const b5 = await app.inject({ method: 'POST', url: '/v1/admin/auth/demo' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual(NOT_FOUND);
    expect(a5.statusCode).toBe(404);
    expect(b5.statusCode).toBe(404);
    expect(a5.json()).toEqual(NOT_FOUND);
    expect(b5.json()).toEqual(NOT_FOUND);
    expect(a5.statusCode).not.toBe(401);
    expect(b5.statusCode).not.toBe(401);
  });
});
