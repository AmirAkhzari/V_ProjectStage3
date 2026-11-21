import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant, type TenantContext } from '../../../platform/db/tenant.js';
import { AppError } from '../../../platform/http/errors.js';
import { completeMockPayment } from '../application/completeMockPayment.js';
import { getMyPayment } from '../application/getPayment.js';

const paymentSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['order', 'wallet_topup', 'subscription']),
    amount: z.number().int().nonnegative(),
    status: z.enum(['pending', 'paid', 'failed', 'cancelled']),
    createdAt: z.string(),
  })
  .strict();

/** A35's body: the demo PSP's verdict. An absent body means "ok", so the PWA can post nothing. */
const mockCompleteBodySchema = z.object({ outcome: z.enum(['ok', 'fail']).default('ok') }).strict();

const mockCompleteSchema = z
  .object({
    ok: z.literal(true),
    data: z.object({ plan: z.enum(['free', 'pro']) }).strict(),
  })
  .strict();

/**
 * Payment app surface. A34 reads the shop's own payment; A35 is the demo PSP and is registered only
 * when demo login is enabled (the A5/B5 pattern), so a production boot cannot mark anything paid.
 */
export const appRoutes: FastifyPluginAsync = async (app) => {
  const tenantOf = (request: FastifyRequest): TenantContext => {
    const tenant = request.tenant;
    if (!tenant?.shopkeeperId) {
      throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    }
    return tenant;
  };
  const pool = () => {
    if (!app.appDb) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return app.appDb;
  };

  app.get(
    '/payments/:id',
    { schema: { operationId: 'A34', response: { 200: paymentSchema } } },
    async (request) => {
      const tenant = tenantOf(request);
      const params = request.params as { id: string };
      const payment = await getMyPayment(pool(), tenant, params.id);
      if (!payment) {
        request.log.info(
          { operationId: 'A34', sub: request.subject?.sub, outcome: 'not_found' },
          'app_payment',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'A34', sub: request.subject?.sub, outcome: 'ok', status: payment.status },
        'app_payment',
      );
      return payment;
    },
  );

  if (!app.demoLogin) return;

  app.post(
    '/payments/:id/mock-complete',
    {
      schema: {
        operationId: 'A35',
        body: mockCompleteBodySchema,
        response: { 200: mockCompleteSchema },
      },
    },
    async (request) => {
      const tenant = tenantOf(request);
      const params = request.params as { id: string };
      const body = mockCompleteBodySchema.parse(request.body ?? {});
      const result = await withTenant(pool(), tenant, (tx) =>
        completeMockPayment(tx.client, { paymentId: params.id, outcome: body.outcome }),
      );
      if (!result) {
        request.log.info(
          { operationId: 'A35', sub: request.subject?.sub, outcome: 'not_found' },
          'app_payment_mock_complete',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A35',
          sub: request.subject?.sub,
          outcome: 'ok',
          status: result.status,
          plan: result.plan,
        },
        'app_payment_mock_complete',
      );
      return { ok: true as const, data: { plan: result.plan } };
    },
  );
};

/** Kept for type-narrowing clarity where Fastify's decorators are structurally typed. */
export type PaymentPool = pg.Pool;
