import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { demoLoginEnabled } from '../../src/platform/auth/demoLogin.js';
import { assertEmptyDemoBody } from '../../src/modules/identity/application/demoAuth.js';
import { assertDemoLoginSeed } from '../../scripts/seed-demo.js';
import { productionApiConfig, testConfig } from '../helpers/config.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };

describe('AUTH-DM-01 demo endpoints in production', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 404 NOT_FOUND for A5/B5 identical to an unknown path', async () => {
    app = await buildApp({ config: productionApiConfig(), healthChecks: [] });
    await expectHidden(app);
  });

  it('keeps A5/B5 hidden when production sets the flag', async () => {
    app = await buildApp({
      config: { ...productionApiConfig(), DEMO_LOGIN_ENABLED: 'true' },
      healthChecks: [],
    });
    await expectHidden(app);
  });
});

describe('demo login flag', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('enables routes only for the exact non-prod string true', async () => {
    expect(demoLoginEnabled('production', 'true')).toBe(false);
    expect(demoLoginEnabled('test', 'TRUE')).toBe(false);
    expect(demoLoginEnabled('test', '1')).toBe(false);
    expect(demoLoginEnabled('test', undefined)).toBe(false);
    expect(demoLoginEnabled('development', 'true')).toBe(true);
    for (const flag of [undefined, 'TRUE', '1', 'false']) {
      app = await buildApp({
        config: testConfig(flag === undefined ? {} : { DEMO_LOGIN_ENABLED: flag }),
        healthChecks: [],
      });
      expect(app.hasRoute({ method: 'POST', url: '/v1/app/auth/demo' })).toBe(false);
      await app.close();
      app = undefined;
    }
    app = await buildApp({
      config: testConfig({ DEMO_LOGIN_ENABLED: 'true' }),
      healthChecks: [],
    });
    expect(app.hasRoute({ method: 'POST', url: '/v1/app/auth/demo' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/v1/admin/auth/demo' })).toBe(true);
    expect(app.printRoutes()).toMatch(/demo \(POST\)/);
  });

  it('rejects a non-empty demo body before a write', () => {
    expect(() => assertEmptyDemoBody(undefined)).not.toThrow();
    expect(() => assertEmptyDemoBody({})).not.toThrow();
    expect(() => assertEmptyDemoBody({ refreshToken: 'x' })).toThrow(/validation/i);
  });

  it('refuses the demo seed in production and without the exact flag', () => {
    const source = readFileSync(join(import.meta.dirname, '../../scripts/seed-demo.ts'), 'utf8');
    expect(source).toContain('assertDemoLoginSeed()');
    expect(source).toContain('DEMO_SHOPKEEPER_PHONE');
    expect(DEMO_PHONE).toBe('+989999999901');
    expect(() =>
      assertDemoLoginSeed({ NODE_ENV: 'production', DEMO_LOGIN_ENABLED: 'true' }),
    ).toThrow(/production/);
    expect(() => assertDemoLoginSeed({ NODE_ENV: 'test' })).toThrow(/DEMO_LOGIN_ENABLED/);
    expect(() => assertDemoLoginSeed({ NODE_ENV: 'test', DEMO_LOGIN_ENABLED: 'TRUE' })).toThrow(
      /DEMO_LOGIN_ENABLED/,
    );
    expect(() =>
      assertDemoLoginSeed({ NODE_ENV: 'test', DEMO_LOGIN_ENABLED: 'true' }),
    ).not.toThrow();
  });
});

const DEMO_PHONE = '+989999999901';

async function expectHidden(app: App): Promise<void> {
  const unknown = await app.inject({ method: 'POST', url: '/no-such-demo-route' });
  const a5 = await app.inject({ method: 'POST', url: '/v1/app/auth/demo' });
  const b5 = await app.inject({ method: 'POST', url: '/v1/admin/auth/demo' });
  expect(a5.statusCode).toBe(404);
  expect(b5.statusCode).toBe(404);
  expect(a5.json()).toEqual(unknown.json());
  expect(b5.json()).toEqual(unknown.json());
  expect(a5.body).toBe(unknown.body);
  expect(b5.body).toBe(unknown.body);
  expect(a5.json()).toEqual(NOT_FOUND);
  expect(app.printRoutes()).not.toMatch(/demo \(POST\)/);
  expect(app.hasRoute({ method: 'POST', url: '/v1/app/auth/demo' })).toBe(false);
  expect(app.hasRoute({ method: 'POST', url: '/v1/admin/auth/demo' })).toBe(false);
}
