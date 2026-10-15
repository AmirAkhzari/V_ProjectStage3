import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../../platform/http/errors.js';

/** A5 is public but 404 in production (AUTH-DM-01). No demo login in Foundation. */
export const appRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/demo', { schema: { operationId: 'A5' } }, async () => {
    throw new AppError('NOT_FOUND', 404, 'Resource not found');
  });
};
