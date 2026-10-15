import type { onRequestAsyncHookHandler } from 'fastify';
import { AppError } from '../http/errors.js';
import type { AccessClaims, AccessTokenVerifier, SubjectType } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    subject?: AccessClaims;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/** Route-group guard: requires a verified token whose `typ` matches the group. */
export function subjectGuard(
  expected: SubjectType,
  verifier: AccessTokenVerifier,
): onRequestAsyncHookHandler {
  return async (request) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');

    let claims: AccessClaims;
    try {
      claims = await verifier.verify(token);
    } catch {
      throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    }
    if (claims.typ !== expected) {
      throw new AppError('TOKEN_TYPE_MISMATCH', 401, 'Token type not accepted on this route group');
    }
    request.subject = claims;
  };
}
