import type { FastifyPluginAsync } from 'fastify';

/** Empty driver surface for `catalog`. Frozen contract endpoints are not implemented in Foundation. */
export const driverRoutes: FastifyPluginAsync = async () => {};
