export type SubjectType = 'shopkeeper' | 'staff' | 'driver';

export const JWT_AUDIENCE = {
  shopkeeper: 'app',
  staff: 'admin',
  driver: 'driver',
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const JWT_CLOCK_SKEW_SECONDS = 60;
export const JWT_ALG = 'EdDSA';

export interface AccessClaims {
  sub: string;
  typ: SubjectType;
  sid: string;
  did?: string;
}

/**
 * Verifies an access token and returns its claims, or throws.
 * S11b-2 provides the jose EdDSA implementation (`eddsa.ts`); guards stay fail-closed
 * until the composition root wires a keyset (S11b-3).
 */
export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessClaims>;
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
