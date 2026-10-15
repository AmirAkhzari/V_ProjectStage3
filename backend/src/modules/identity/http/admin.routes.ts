import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../../platform/http/errors.js';

/** B5 is public but 404 in production (AUTH-DM-01). No demo login in Foundation. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/demo', { schema: { operationId: 'B5' } }, async () => {
    throw new AppError('NOT_FOUND', 404, 'Resource not found');
  });
};
