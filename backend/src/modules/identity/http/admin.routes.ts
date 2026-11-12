import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../../platform/http/errors.js';
import {
  assertEmptyLogoutBody,
  logoutStaffSid,
  presentedRefreshToken,
  refreshCallContext,
  refreshStaff,
  refreshUnauthenticated,
} from '../application/refreshAuth.js';
import { otpRoutePlugin } from './otp.routes.js';

/** J-1: B5 is not registered in production. Non-prod keeps a 404 stub (AUTH-DM-01). */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(otpRoutePlugin('staff', { send: 'B1', verify: 'B2' }));
  app.post('/auth/refresh', { schema: { operationId: 'B3' } }, async (request) => {
    if (!app.otpAuth) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    const token = presentedRefreshToken(request.body);
    if (!token) throw refreshUnauthenticated();
    return refreshStaff(
      app.otpAuth,
      token,
      refreshCallContext(request.ip, request.headers['user-agent']),
    );
  });
  app.post('/auth/logout', { schema: { operationId: 'B4' } }, async (request) => {
    assertEmptyLogoutBody(request.body);
    if (!app.otpAuth) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    const sid = request.subject?.sid;
    if (!sid) throw refreshUnauthenticated();
    return logoutStaffSid(
      app.otpAuth,
      sid,
      refreshCallContext(request.ip, request.headers['user-agent']),
    );
  });
  if (app.nodeEnv === 'production') return;
  app.post('/auth/demo', { schema: { operationId: 'B5' } }, async () => {
    throw new AppError('NOT_FOUND', 404, 'Resource not found');
  });
};
