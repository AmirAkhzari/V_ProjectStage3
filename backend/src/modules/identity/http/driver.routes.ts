import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../platform/http/errors.js';
import { loginDriver, refreshDriver, type DriverAuthRuntime } from '../application/driverAuth.js';

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
const refreshBody = z.object({ refreshToken: z.string().min(43).max(512) }).strict();

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
    '/auth/refresh',
    { schema: { operationId: 'C2', body: refreshBody } },
    async (request) => {
      const body = request.body as z.infer<typeof refreshBody>;
      return driverRefreshSession.parse(await refreshDriver(runtimeOf(app), body.refreshToken));
    },
  );
};
