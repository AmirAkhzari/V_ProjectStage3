import Fastify from 'fastify';
import swagger from '@fastify/swagger';
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
import type { SessionAuthority } from './platform/auth/sessionAuthority.js';
import type { Config } from './platform/config.js';
import { InProcessEventBus } from './platform/events/bus.js';
import { InMemoryInboxStore } from './platform/events/inbox.js';
import type { HealthCheck } from './platform/health.js';
import { registerErrorHandling } from './platform/http/errors.js';
import { generateRequestId, registerRequestContext } from './platform/http/requestContext.js';
import { pinoOptions } from './platform/logger.js';

export interface BuildAppOptions {
  config: Config;
  healthChecks: readonly HealthCheck[];
  verifier?: AccessTokenVerifier;
  sessionAuthority?: SessionAuthority;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: pinoOptions(options.config),
    genReqId: generateRequestId,
    // Do not let Fastify copy x-request-id before validation (AppSec L-3).
    requestIdHeader: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerRequestContext(app);
  registerErrorHandling(app);

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

  const groupOpts = {
    modules: allModules,
    verifier: options.verifier ?? denyAllVerifier,
    ...(options.sessionAuthority ? { sessionAuthority: options.sessionAuthority } : {}),
  };
  await app.register(appGroup, { prefix: appGroupSpec.prefix, ...groupOpts });
  await app.register(adminGroup, { prefix: adminGroupSpec.prefix, ...groupOpts });
  await app.register(driverGroup, { prefix: driverGroupSpec.prefix, ...groupOpts });

  const bus = new InProcessEventBus(new InMemoryInboxStore());
  for (const mod of allModules) {
    await mod.register?.({ bus });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
