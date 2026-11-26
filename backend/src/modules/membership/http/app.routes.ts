import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { getMySubscription } from '../application/getSubscription.js';
import {
  readCheckoutIdempotencyKey,
  startSubscriptionCheckout,
} from '../application/startSubscriptionCheckout.js';

/** One purchased period, exactly as A14's history lists it. */
const subscriptionHistorySchema = z
  .object({
    id: z.uuid(),
    plan: z.literal('pro'),
    status: z.enum(['active', 'expired']),
    startsAt: z.string(),
    expiresAt: z.string(),
  })
  .strict();

/** A14: the shop's plan, its expiry, the price of the next period and the whole history. */
const mySubscriptionSchema = z
  .object({
    plan: z.enum(['free', 'pro']),
    primaryDistributorId: z.uuid().nullable(),
    expiresAt: z.string().nullable(),
    renewal: z.boolean(),
    price: z.number().int().nonnegative(),
    history: z.array(subscriptionHistorySchema),
  })
  .strict();

/** A15: the payment intent A36 starts at the gateway and S3 settles. */
const checkoutIntentSchema = z
  .object({
    paymentId: z.uuid(),
    redirectUrl: z.string(),
    amount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * App surface for `membership`: A14 reads the shop's own subscription and A15 starts a Pro checkout.
 * Neither handler touches `membership.subscriptions`; the period is created by S3 (payment module) once
 * the provider has verified the money, so a plan cannot be minted without a payment.
 */
export const appRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/me/subscription',
    { schema: { operationId: 'A14', response: { 200: mySubscriptionSchema } } },
    async (request) => {
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
      const subscription = await getMySubscription(pool, tenant);
      if (!subscription) {
        request.log.info(
          { operationId: 'A14', sub: request.subject?.sub, outcome: 'not_found' },
          'app_subscription',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A14',
          sub: request.subject?.sub,
          outcome: 'ok',
          plan: subscription.plan,
          periods: subscription.history.length,
        },
        'app_subscription',
      );
      return subscription;
    },
  );

  app.post(
    '/me/subscription/checkout',
    { schema: { operationId: 'A15', response: { 200: checkoutIntentSchema } } },
    async (request) => {
      const idempotencyKey = readCheckoutIdempotencyKey(request.headers['idempotency-key']);
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
      const intent = await startSubscriptionCheckout(pool, tenant, idempotencyKey);
      if (!intent) {
        request.log.info(
          { operationId: 'A15', sub: request.subject?.sub, outcome: 'not_found' },
          'app_subscription_checkout',
        );
        throw new AppError('NOT_FOUND', 404, 'Resource not found');
      }
      request.log.info(
        {
          operationId: 'A15',
          sub: request.subject?.sub,
          outcome: 'ok',
          paymentId: intent.paymentId,
        },
        'app_subscription_checkout',
      );
      return intent;
    },
  );
};
