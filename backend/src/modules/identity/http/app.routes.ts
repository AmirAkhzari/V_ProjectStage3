import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../../platform/http/errors.js';
import {
  logoutShopkeeperRefresh,
  presentedRefreshToken,
  refreshCallContext,
  refreshShopkeeper,
  refreshUnauthenticated,
  requireLogoutToken,
} from '../application/refreshAuth.js';
import { otpRoutePlugin } from './otp.routes.js';

/** J-1: A5 is not registered in production. Non-prod keeps a 404 stub (AUTH-DM-01). */
export const appRoutes: FastifyPluginAsync = async (app) => {
  await app.register(otpRoutePlugin('app', { send: 'A1', verify: 'A2' }));
  app.post('/auth/refresh', { schema: { operationId: 'A3' } }, async (request) => {
    if (!app.otpAuth) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    const token = presentedRefreshToken(request.body);
    if (!token) throw refreshUnauthenticated();
    return refreshShopkeeper(
      app.otpAuth,
      token,
      refreshCallContext(request.ip, request.headers['user-agent']),
    );
  });
  app.post('/auth/logout', { schema: { operationId: 'A4' } }, async (request) => {
    if (!app.otpAuth) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return logoutShopkeeperRefresh(
      app.otpAuth,
      requireLogoutToken(request.body),
      refreshCallContext(request.ip, request.headers['user-agent']),
    );
  });
  if (app.nodeEnv === 'production') return;
  app.post('/auth/demo', { schema: { operationId: 'A5' } }, async () => {
    throw new AppError('NOT_FOUND', 404, 'Resource not found');
  });
};
