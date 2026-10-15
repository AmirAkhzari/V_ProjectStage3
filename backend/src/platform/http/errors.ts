import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';

/**
 * Error codes the platform layer emits. Every value must exist in the frozen contract's
 * `components.schemas.ErrorCode` enum (enforced by tests/contract).
 */
export const PLATFORM_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_TYPE_MISMATCH',
  'NOT_FOUND',
  'INTERNAL',
  'DEPENDENCY_UNAVAILABLE',
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export class AppError extends Error {
  readonly code: PlatformErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: PlatformErrorCode, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function errorEnvelope(
  code: PlatformErrorCode,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send(errorEnvelope('NOT_FOUND', 'Resource not found'));
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send(errorEnvelope(error.code, error.message, error.details));
    }
    if (hasZodFastifySchemaValidationErrors(error) || error.validation) {
      return reply
        .code(400)
        .send(errorEnvelope('VALIDATION_FAILED', 'Request validation failed', error.validation));
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(errorEnvelope('VALIDATION_FAILED', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorEnvelope('INTERNAL', 'Internal server error'));
  });
}
