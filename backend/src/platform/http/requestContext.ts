import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function isSafeRequestId(value: string): boolean {
  return SAFE_REQUEST_ID.test(value);
}

/** Reuses a well-formed inbound `x-request-id`, otherwise generates a UUID. */
export function generateRequestId(req: Pick<IncomingMessage, 'headers'>): string {
  const inbound = req.headers[REQUEST_ID_HEADER];
  if (typeof inbound === 'string' && isSafeRequestId(inbound)) return inbound;
  return randomUUID();
}

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
  });
}
