import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { receiveProviderCallback } from '../application/receiveProviderCallback.js';

/**
 * S3: `POST /v1/payments/callback/{provider}` — the only payment route outside the three API groups,
 * because a PSP has no session (DL-11). It is public (`PUBLIC_ROUTES`) and unsigned, so the body is a
 * hint only; `receiveProviderCallback` asks the provider to verify the authority before any money is
 * treated as paid.
 *
 * The body is the gateway double's vocabulary (`authority` + `outcome`); a real PSP adapter maps its
 * own notification into this shape inside the provider, not in the route.
 */
const callbackBodySchema = z
  .object({
    authority: z.string().min(1).max(128),
    outcome: z.enum(['ok', 'fail']),
  })
  .strict();

const callbackResponseSchema = z
  .object({
    ok: z.literal(true),
    paymentId: z.uuid(),
    status: z.enum(['pending', 'paid', 'failed', 'cancelled']),
  })
  .strict();

export const paymentCallbackRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/v1/payments/callback/:provider',
    {
      schema: {
        operationId: 'S3',
        body: callbackBodySchema,
        response: { 200: callbackResponseSchema },
      },
    },
    async (request) => {
      const pool = app.appDb;
      if (!pool) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
          retryAfter: 5,
        });
      }
      const { provider } = request.params as { provider: string };
      const body = request.body as { authority: string; outcome: 'ok' | 'fail' };
      const result = await receiveProviderCallback(pool, {
        provider,
        authority: body.authority,
        outcome: body.outcome,
      });
      if (!result) {
        request.log.info({ operationId: 'S3', provider, outcome: 'not_found' }, 'payment_callback');
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        { operationId: 'S3', provider, outcome: 'ok', status: result.status },
        'payment_callback',
      );
      return { ok: true as const, paymentId: result.paymentId, status: result.status };
    },
  );
};
