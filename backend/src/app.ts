import Fastify, { type FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import type { DestinationStream } from 'pino';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { adminGroup, adminGroupSpec } from './http/admin.group.js';
import { appGroup, appGroupSpec } from './http/app.group.js';
import { driverGroup, driverGroupSpec } from './http/driver.group.js';
import { systemRoutes } from './http/system.routes.js';
import { allModules } from './modules/register.js';
import { denyAllVerifier, type AccessTokenVerifier } from './platform/auth/jwt.js';
import {
  failClosedSessionAuthority,
  type SessionAuthority,
} from './platform/auth/sessionAuthority.js';
import { AppError } from './platform/http/errors.js';
import type { DriverAuthRuntime } from './modules/identity/application/driverAuth.js';
import type { OtpAuthRuntime } from './modules/identity/application/otpAuth.js';
import type { Config } from './platform/config.js';
import { InProcessEventBus } from './platform/events/bus.js';
import { InMemoryInboxStore } from './platform/events/inbox.js';
import type { HealthCheck } from './platform/health.js';
import { registerErrorHandling } from './platform/http/errors.js';
import { generateRequestId, registerRequestContext } from './platform/http/requestContext.js';
import { demoLoginEnabled } from './platform/auth/demoLogin.js';
import { demoRateFromConfig } from './modules/identity/application/demoRate.js';
import { pinoOptions } from './platform/logger.js';

declare module 'fastify' {
  interface FastifyInstance {
    nodeEnv: Config['NODE_ENV'];
    demoLogin: boolean;
    demoRate?: { perIpHour: number; globalDay: number };
    driverAuth?: DriverAuthRuntime;
    otpAuth?: OtpAuthRuntime;
  }
}

export interface BuildAppOptions {
  config: Config;
  healthChecks: readonly HealthCheck[];
  verifier?: AccessTokenVerifier;
  sessionAuthority?: SessionAuthority;
  assertIssuance?: () => Promise<void>;
  driverAuth?: DriverAuthRuntime;
  otpAuth?: OtpAuthRuntime;
  /** Test capture. Production uses Fastify's default destination. */
  logDestination?: DestinationStream;
  /** Test-only plugin mounted inside `/v1/admin` before the catch-all. */
  adminTestRoutes?: FastifyPluginAsync;
}

export async function buildApp(options: BuildAppOptions) {
  const hops = options.config.TRUST_PROXY_HOPS;
  const app = Fastify({
    logger: options.logDestination
      ? { ...pinoOptions(options.config), stream: options.logDestination }
      : pinoOptions(options.config),
    genReqId: generateRequestId,
    // Do not let Fastify copy x-request-id before validation (AppSec L-3).
    requestIdHeader: false,
    // API port is reachable only through the LB; trust only TRUST_PROXY_HOPS hops.
    trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerRequestContext(app);
  registerErrorHandling(app);
  app.decorate('nodeEnv', options.config.NODE_ENV);
  app.decorate(
    'demoLogin',
    demoLoginEnabled(
      options.config.NODE_ENV,
      options.config.DEPLOY_ENV,
      options.config.DEMO_LOGIN_ENABLED,
    ),
  );
  const demoRate = demoRateFromConfig(options.config);
  if (demoRate) app.decorate('demoRate', demoRate);
  if (options.driverAuth) app.decorate('driverAuth', options.driverAuth);
  if (options.otpAuth) app.decorate('otpAuth', options.otpAuth);

  if (options.config.OPENAPI_DOCS_ENABLED) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'V-Project API (code skeleton)',
          version: '0.0.0-foundation',
          description:
            'Generated from currently registered Fastify routes. The frozen contract is backend/openapi/openapi-v1.0.0.yaml and must not be overwritten.',
        },
      },
      transform: jsonSchemaTransform,
    });
  }

  await app.register(systemRoutes, {
    healthChecks: options.healthChecks,
    healthCheckTimeoutMs: options.config.HEALTH_CHECK_TIMEOUT_MS,
    readyRetryAfterSeconds: options.config.READY_RETRY_AFTER_SECONDS,
  });

  const verifier = options.verifier ?? denyAllVerifier;
  if (verifier !== denyAllVerifier && options.sessionAuthority === undefined) {
    throw new Error('sessionAuthority is required unless the verifier is denyAllVerifier');
  }
  const assertIssuance =
    options.assertIssuance ??
    (async () => {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    });
  const groupOpts = {
    modules: allModules,
    verifier,
    sessionAuthority: options.sessionAuthority ?? failClosedSessionAuthority,
    assertIssuance,
  };
  await app.register(appGroup, { prefix: appGroupSpec.prefix, ...groupOpts });
  await app.register(adminGroup, {
    prefix: adminGroupSpec.prefix,
    ...groupOpts,
    ...(options.adminTestRoutes ? { extraRoutes: options.adminTestRoutes } : {}),
  });
  await app.register(driverGroup, { prefix: driverGroupSpec.prefix, ...groupOpts });

  const bus = new InProcessEventBus(new InMemoryInboxStore());
  for (const mod of allModules) {
    await mod.register?.({ bus });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
