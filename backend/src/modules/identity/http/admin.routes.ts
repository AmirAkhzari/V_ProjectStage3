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
import { guardDemoLoginRate } from '../application/demoRate.js';
import { unavailable, unlockDriver } from '../application/unlockDriver.js';
import { otpRoutePlugin } from './otp.routes.js';

/** B5 is omitted unless demo login is enabled. ScopeDistributor is not read. */
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
      refreshCallContext(request.ip, request.headers['user-agent'], app.demoLogin),
    );
  });
  app.post<{ Params: { id: string } }>(
    '/drivers/:id/unlock',
    { schema: { operationId: 'B83' } },
    async (request) => {
      if (!app.otpAuth || !request.subject) throw unavailable();
      const tenant = request.tenant;
      // Super_admin must scope; isPlatform never looks up a driver.
      if (!tenant || tenant.isPlatform === true || !tenant.distributorId) {
        throw new AppError('VALIDATION_FAILED', 400, 'Request could not be processed');
      }
      return unlockDriver(
        { identityPool: app.otpAuth.identityPool, redis: app.otpAuth.redis, log: app.otpAuth.log },
        {
          driverId: request.params.id,
          staffId: request.subject.sub,
          staffRole: request.staffRole ?? 'staff',
          distributorId: tenant.distributorId,
          body: request.body,
          idempotencyKeyHeader: request.headers['idempotency-key'],
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );
    },
  );
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
      refreshCallContext(request.ip, request.headers['user-agent'], app.demoLogin),
    );
  });
  if (!app.demoLogin) return;
  const { assertEmptyDemoBody, loginDemoStaff } = await import('../application/demoAuth.js');
  app.post('/auth/demo', { schema: { operationId: 'B5' } }, async (request) => {
    assertEmptyDemoBody(request.body);
    await guardDemoLoginRate(app.otpAuth?.redis, request.ip, app.demoRate);
    if (!app.otpAuth) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
        retryAfter: 5,
      });
    }
    return loginDemoStaff(app.otpAuth, request.ip);
  });
};
