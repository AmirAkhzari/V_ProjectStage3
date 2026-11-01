import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../../platform/http/errors.js';

/** J-1: A5 is not registered in production. Non-prod keeps a 404 stub (AUTH-DM-01). */
export const appRoutes: FastifyPluginAsync = async (app) => {
  if (app.nodeEnv === 'production') return;
  app.post('/auth/demo', { schema: { operationId: 'A5' } }, async () => {
    throw new AppError('NOT_FOUND', 404, 'Resource not found');
  });
};
