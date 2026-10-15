import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { testConfig } from '../helpers/config.js';

describe('system probes', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /health returns 200 with a status-only body', async () => {
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
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /health stays 200 when a dependency is down (liveness)', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [
        {
          name: 'postgres',
          check: () => Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:5432')),
        },
        { name: 'redis', check: () => Promise.resolve() },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'degraded' });
    expect(response.body).not.toContain('10.1.2.3');
    expect(response.body).not.toContain('ECONNREFUSED');
    expect(response.body).not.toContain('checks');
  });

  it('GET /ready returns 503 without dependency details', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [
        {
          name: 'postgres',
          check: () => Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:5432')),
        },
        { name: 'redis', check: () => Promise.resolve() },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    });
    expect(response.body).not.toContain('10.1.2.3');
    expect(response.body).not.toContain('postgres');
    expect(response.body).not.toContain('details');
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

  it('does not echo a malformed inbound request id', async () => {
    app = await buildApp({
      config: testConfig(),
      healthChecks: [],
    });
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-12345678\nSet-Cookie: x' },
    });
    expect(response.headers['x-request-id']).not.toBe('req-12345678\nSet-Cookie: x');
    expect(String(response.headers['x-request-id'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
