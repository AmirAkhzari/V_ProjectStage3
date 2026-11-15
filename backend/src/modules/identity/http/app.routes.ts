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

/** A5 is omitted unless demo login is enabled, so the catch-all 404 matches an unknown route. */
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
      refreshCallContext(request.ip, request.headers['user-agent'], app.demoLogin),
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
      refreshCallContext(request.ip, request.headers['user-agent'], app.demoLogin),
    );
  });
  if (!app.demoLogin) return;
  const { assertEmptyDemoBody, loginDemoShopkeeper } = await import('../application/demoAuth.js');
  app.post('/auth/demo', { schema: { operationId: 'A5' } }, async (request) => {
    assertEmptyDemoBody(request.body);
    if (!app.otpAuth) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return loginDemoShopkeeper(app.otpAuth, request.ip);
  });
};
