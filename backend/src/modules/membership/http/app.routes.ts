import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { getMySubscription } from '../application/getSubscription.js';

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

/**
 * App surface for `membership`: only A14 reads the shop's own subscription. A15 (Pro checkout) is
 * PENDING since FIX-PR1: unmounted, with its application code dormant until payments re-entry.
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
};
