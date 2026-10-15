import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { runHealthChecks, type HealthCheck } from '../platform/health.js';
import { errorEnvelope, errorEnvelopeSchema } from '../platform/http/errors.js';

export interface SystemRoutesOptions {
  healthChecks: readonly HealthCheck[];
  healthCheckTimeoutMs: number;
}

const dependencySchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number(),
  error: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), dependencySchema),
});

export const readyResponseSchema = z.object({
  status: z.literal('ok'),
  checks: z.record(z.string(), dependencySchema),
});

/**
 * System routes outside the three API groups (DL-11). S1 `/health` includes Postgres and Redis
 * checks (launch brief 2026-10-15) and stays a liveness probe (HTTP 200 while the process is up).
 * S2 `/ready` fails closed with 503 when a dependency is down. S3 payment callback is not
 * registered in Foundation.
 */
export const systemRoutes: FastifyPluginAsync<SystemRoutesOptions> = async (app, opts) => {
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
      const report = await runHealthChecks(opts.healthChecks, opts.healthCheckTimeoutMs);
      return reply.code(200).send(report);
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
      const report = await runHealthChecks(opts.healthChecks, opts.healthCheckTimeoutMs);
      if (report.status === 'ok') {
        return reply.code(200).send({ status: 'ok' as const, checks: report.checks });
      }
      return reply.code(503).send(
        errorEnvelope('DEPENDENCY_UNAVAILABLE', 'One or more dependencies are unavailable', {
          checks: report.checks,
        }),
      );
    },
  );
};
