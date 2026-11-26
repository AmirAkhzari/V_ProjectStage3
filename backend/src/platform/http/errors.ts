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
  'SESSION_REVOKED',
  'FORBIDDEN',
  'DISTRIBUTOR_LOCKED',
  'MARKETPLACE_REQUIRES_PRO',
  'PAYMENT_VERIFICATION_PENDING',
  'PAYMENT_NOT_STARTABLE',
  'NOT_FOUND',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSE',
  'IDEMPOTENCY_IN_PROGRESS',
  'REASON_REQUIRED',
  'REASON_TOO_LONG',
  'too_many_attempts',
  'invalid_credentials',
  'OTP_INVALID',
  'OTP_LOCKED',
  'driver_inactive',
  'PASSWORD_CHANGE_REQUIRED',
  'CURRENT_PASSWORD_INVALID',
  'PASSWORD_REUSED',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_BREACHED',
  'session_expired',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
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

/** Unhandled 404/405 stay NOT_FOUND; other 4xx are VALIDATION_FAILED. Never INTERNAL (R2-3). */
export function clientErrorEnvelope(statusCode: number, _message: string): ErrorEnvelope {
  if (statusCode === 404 || statusCode === 405) {
    return errorEnvelope('NOT_FOUND', 'Resource not found');
  }
  if (statusCode === 413) {
    return errorEnvelope('VALIDATION_FAILED', 'Payload too large', { statusCode });
  }
  return errorEnvelope('VALIDATION_FAILED', 'Request could not be processed');
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
      if (error.statusCode === 503 || error.statusCode === 429) {
        const retryAfter =
          error.details &&
          typeof error.details === 'object' &&
          'retryAfter' in error.details &&
          typeof error.details.retryAfter === 'number'
            ? error.details.retryAfter
            : 5;
        void reply.header('retry-after', String(retryAfter));
      }
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
      return reply
        .code(error.statusCode)
        .send(clientErrorEnvelope(error.statusCode, error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorEnvelope('INTERNAL', 'Internal server error'));
  });
}
