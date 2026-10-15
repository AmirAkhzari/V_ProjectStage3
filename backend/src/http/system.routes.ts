import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HealthMonitor, type HealthCheck } from '../platform/health.js';
import { errorEnvelope, errorEnvelopeSchema } from '../platform/http/errors.js';

export interface SystemRoutesOptions {
  healthChecks: readonly HealthCheck[];
  healthCheckTimeoutMs: number;
}

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
});

export const readyResponseSchema = z.object({
  status: z.literal('ok'),
});

/**
 * System routes outside the three API groups (DL-11). Public bodies are status-only (AppSec M-3b);
 * per-dependency detail is logged, never returned. S3 payment callback is not registered.
 */
export const systemRoutes: FastifyPluginAsync<SystemRoutesOptions> = async (app, opts) => {
  const monitor = new HealthMonitor({
    checks: opts.healthChecks,
    timeoutMs: opts.healthCheckTimeoutMs,
    ttlMs: 1500,
    log: app.log,
  });
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/health',
    {
      schema: {
        operationId: 'S1',
        tags: ['platform'],
        summary: 'Liveness with Postgres and Redis checks',
        response: { 200: healthResponseSchema },
      },
    },
    async (_request, reply) => {
      const report = await monitor.snapshot();
      return reply.code(200).send({ status: report.status });
    },
  );

  typed.get(
    '/ready',
    {
      schema: {
        operationId: 'S2',
        tags: ['platform'],
        summary: 'Readiness (Postgres + Redis)',
        response: { 200: readyResponseSchema, 503: errorEnvelopeSchema },
      },
    },
    async (_request, reply) => {
      const report = await monitor.snapshot();
      if (report.status === 'ok') {
        return reply.code(200).send({ status: 'ok' as const });
      }
      return reply
        .code(503)
        .send(errorEnvelope('DEPENDENCY_UNAVAILABLE', 'One or more dependencies are unavailable'));
    },
  );
};
