import type { FastifyPluginAsync } from 'fastify';

/**
 * Payment app surface: empty on purpose. A34 (read a payment) and A35 (demo PSP verdict) are PENDING
 * since FIX-PR1 — unmounted in every boot, including demo boots, until payments re-entry. Their
 * application code stays dormant; the group catch-all answers the byte-identical 404.
 */
export const appRoutes: FastifyPluginAsync = async () => {};
