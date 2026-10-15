import type { FastifyPluginAsync } from 'fastify';

/** Empty driver surface for `payment`. Frozen contract endpoints are not implemented in Foundation. */
export const driverRoutes: FastifyPluginAsync = async () => {};
