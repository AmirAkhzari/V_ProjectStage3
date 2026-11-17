import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { changeDriverPassword } from '../application/changeDriverPassword.js';
import { loginDriver, refreshDriver, type DriverAuthRuntime } from '../application/driverAuth.js';
import { loadBreachedPasswordList } from '../infra/crypto/breachedPasswords.js';
import {
  presentedRefreshToken,
  refreshCallContext,
  refreshUnauthenticated,
} from '../application/refreshAuth.js';

const driverUser = z
  .object({
    id: z.string().min(1),
    username: z.string().min(1).max(64),
    distributorId: z.string().min(1),
  })
  .strict();

const sessionCore = {
  accessToken: z.string().min(1).max(4096),
  accessTokenExpiresAt: z.string().datetime(),
  absoluteExpiresAt: z.string().datetime(),
  tokenType: z.literal('Bearer'),
  mustChangePassword: z.boolean(),
  driver: driverUser,
};

const driverAuthSession = z
  .object({
    ...sessionCore,
    refreshToken: z.string().min(43).max(512),
    refreshExpiresAt: z.string().datetime(),
  })
  .strict();

const driverRefreshSession = z
  .object({
    ...sessionCore,
    refreshToken: z.string().min(43).max(512).optional(),
    refreshExpiresAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((row) => (row.refreshToken === undefined) === (row.refreshExpiresAt === undefined), {
    message: 'refreshToken and refreshExpiresAt are paired',
  });

const loginBody = z.object({ username: z.string(), password: z.string() }).strict();

/**
 * C11 body. `newPassword` is 1..128 rather than the contract's minLength 8 so a 7-char
 * password reaches the AUTH-PW-02 policy and returns 422 PASSWORD_TOO_SHORT (C11-04), not a
 * generic 400. The 128 cap is enforced here, before any hashing.
 */
const passwordChangeBody = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(1).max(128),
  })
  .strict();

let breachedList: ReturnType<typeof loadBreachedPasswordList> | undefined;
function breachedCheck(): (normalized: string) => boolean {
  breachedList ??= loadBreachedPasswordList();
  return (normalized) => breachedList?.has(normalized) ?? false;
}

function runtimeOf(app: { driverAuth?: DriverAuthRuntime }): DriverAuthRuntime {
  if (!app.driverAuth) {
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'Service temporarily unavailable', {
      retryAfter: 5,
    });
  }
  return app.driverAuth;
}

export const driverRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', { schema: { operationId: 'C1', body: loginBody } }, async (request) => {
    const body = request.body as z.infer<typeof loginBody>;
    return driverAuthSession.parse(
      await loginDriver(runtimeOf(app), {
        username: body.username,
        password: body.password,
        ip: request.ip,
      }),
    );
  });
  app.post(
    '/auth/password',
    {
      schema: {
        operationId: 'C11',
        body: passwordChangeBody,
        response: { 200: driverAuthSession },
      },
    },
    async (request) => {
      const subject = request.subject;
      if (!subject) {
        throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
      }
      const body = request.body as z.infer<typeof passwordChangeBody>;
      let outcome = 'ok';
      try {
        // Identity comes from the token only; a body `driverId` fails `.strict()` first.
        return driverAuthSession.parse(
          await changeDriverPassword(
            { ...runtimeOf(app), breachedPassword: breachedCheck() },
            { accountId: subject.sub, sid: subject.sid, ...body, ip: request.ip },
          ),
        );
      } catch (error) {
        outcome = error instanceof AppError ? error.code : 'error';
        throw error;
      } finally {
        request.log.info(
          { operationId: 'C11', sub: subject.sub, outcome },
          'driver_password_change',
        );
      }
    },
  );
  app.post('/auth/refresh', { schema: { operationId: 'C2' } }, async (request) => {
    const token = presentedRefreshToken(request.body);
    if (!token) throw refreshUnauthenticated();
    return driverRefreshSession.parse(
      await refreshDriver(
        runtimeOf(app),
        token,
        refreshCallContext(request.ip, request.headers['user-agent']),
      ),
    );
  });
};
