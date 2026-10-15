import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { testConfig } from '../helpers/config.js';

describe('system probes', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /health returns 200 with postgres and redis checks', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [
        { name: 'postgres', check: () => Promise.resolve() },
        { name: 'redis', check: () => Promise.resolve() },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    const body = response.json() as { status: string; checks: Record<string, { status: string }> };
    expect(body.status).toBe('ok');
    expect(body.checks['postgres']?.status).toBe('up');
    expect(body.checks['redis']?.status).toBe('up');
  });

  it('GET /health stays 200 when a dependency is down (liveness)', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [
        { name: 'postgres', check: () => Promise.reject(new Error('down')) },
        { name: 'redis', check: () => Promise.resolve() },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'degraded' });
  });

  it('GET /ready returns 503 when a dependency is down', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [
        { name: 'postgres', check: () => Promise.reject(new Error('down')) },
        { name: 'redis', check: () => Promise.resolve() },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } });
  });

  it('echoes a well-formed inbound request id', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
    });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(response.headers['x-request-id']).toBe('req-12345678');
  });
});
