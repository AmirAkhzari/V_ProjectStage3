export type SubjectType = 'shopkeeper' | 'staff' | 'driver';

export const JWT_AUDIENCE = {
  shopkeeper: 'app',
  staff: 'admin',
  driver: 'driver',
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const JWT_CLOCK_SKEW_SECONDS = 60;
export const JWT_ALG = 'EdDSA';
export const JWT_TYP = 'JWT';

export interface AccessClaims {
  sub: string;
  typ: SubjectType;
  sid: string;
  sv: number;
  did?: string;
}

/**
 * Verifies an access token bound to a route group (AppSec 9-8).
 */
export interface AccessTokenVerifier {
  verify(token: string, expectedGroup: SubjectType): Promise<AccessClaims>;
}

export class TokenVerificationError extends Error {
  constructor(message = 'token verification unavailable') {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/** Fail-closed default: no token is ever accepted until a real verifier is wired. */
export const denyAllVerifier: AccessTokenVerifier = {
  verify() {
    return Promise.reject(new TokenVerificationError());
  },
};
