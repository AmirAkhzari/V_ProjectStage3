import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { readIdempotencyKey } from '../../../platform/http/idempotencyKey.js';
import { startPayment } from '../application/startPayment.js';

/** A36: the redirect the PWA navigates the shop to. */
const paymentStartSchema = z
  .object({
    paymentId: z.uuid(),
    redirectUrl: z.string(),
    amount: z.number().int().nonnegative(),
    status: z.literal('pending'),
    authority: z.string(),
    attempts: z.number().int().min(1).max(3),
  })
  .strict();

/**
 * Payment app surface: A36 only. A34 (read a payment) and A35 (demo PSP verdict) stay PENDING since
 * FIX-PR1 — unmounted in every boot — until their own re-entry; A35 is superseded by S3's callback,
 * which is where a real PSP will settle a payment. The group catch-all still answers A34/A35 with the
 * byte-identical 404.
 */
export const appRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/payments/:id/start',
    { schema: { operationId: 'A36', response: { 200: paymentStartSchema } } },
    async (request) => {
      // The header is the frozen contract's `IdempotencyKey` (mandatory, 16..128). The stored
      // authority, not the header, is what makes a retry safe: a pending intent re-uses it.
      readIdempotencyKey(request.headers['idempotency-key']);
      const tenant = request.tenant;
      if (!tenant?.shopkeeperId) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const { id } = request.params as { id: string };
      const started = await startPayment(pool, tenant, id);
      if (!started) {
        request.log.info(
          { operationId: 'A36', sub: request.subject?.sub, outcome: 'not_found' },
          'app_payment_start',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A36',
          sub: request.subject?.sub,
          outcome: 'ok',
          paymentId: started.paymentId,
          attempts: started.attempts,
        },
        'app_payment_start',
      );
      return started;
    },
  );
};
