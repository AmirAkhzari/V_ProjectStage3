import { describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { productionApiConfig, testConfig } from '../helpers/config.js';

const UNMOUNTED = [
  { operationId: 'A15', method: 'POST', url: '/v1/app/me/subscription/checkout' },
  { operationId: 'A34', method: 'GET', url: '/v1/app/payments/:id' },
  { operationId: 'A35', method: 'POST', url: '/v1/app/payments/:id/mock-complete' },
] as const;

const PROBES = [
  { method: 'POST', url: '/v1/app/me/subscription/checkout' },
  { method: 'GET', url: '/v1/app/payments/00000000-0000-4000-8000-000000000001' },
  { method: 'POST', url: '/v1/app/payments/00000000-0000-4000-8000-000000000001/mock-complete' },
] as const;

const BOOTS: readonly { name: string; config: ReturnType<typeof testConfig> }[] = [
  { name: 'production', config: productionApiConfig() },
  {
    name: 'staging demo',
    config: productionApiConfig({
      DEPLOY_ENV: 'staging',
      DEMO_LOGIN_ENABLED: 'true',
      RATE_DEMO_PER_IP_HOUR: '10',
      RATE_DEMO_GLOBAL_DAY: '200',
    }),
  },
  {
    name: 'dev demo',
    config: testConfig({ NODE_ENV: 'development', DEMO_LOGIN_ENABLED: 'true' }),
  },
];

function withoutRequestId(headers: Record<string, unknown>): Record<string, unknown> {
  const { 'x-request-id': _requestId, ...rest } = headers;
  return rest;
}

describe('payment surface is unmounted in every boot (FIX-PR1)', () => {
  for (const boot of BOOTS) {
    it(`${boot.name}: A15/A34/A35 are absent and answer exactly like an unknown group path`, async () => {
      const app: App = await buildApp({ config: boot.config, healthChecks: [] });
      try {
        for (const route of UNMOUNTED) {
          expect(app.hasRoute({ method: route.method, url: route.url }), route.operationId).toBe(
            false,
          );
        }
        const headers = { 'x-request-id': `unmounted-${boot.name}` };
        for (const probe of PROBES) {
          const missing = await app.inject({
            method: probe.method,
            url: '/v1/app/no-such-route',
            headers,
          });
          const response = await app.inject({ method: probe.method, url: probe.url, headers });
          expect(response.statusCode).toBe(missing.statusCode);
          // Anonymous probes stop at the group guard; an unmounted op must look exactly like a
          // path the group never had (the guard runs before the catch-all 404).
          expect(response.statusCode).toBe(401);
          expect(response.body).toBe(missing.body);
          expect(withoutRequestId(response.headers)).toEqual(withoutRequestId(missing.headers));
        }
      } finally {
        await app.close();
      }
    });
  }
});
