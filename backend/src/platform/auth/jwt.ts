export type SubjectType = 'shopkeeper' | 'staff' | 'driver';

export interface AccessClaims {
  sub: string;
  typ: SubjectType;
  sid: string;
}

/**
 * Verifies an access token and returns its claims, or throws.
 * The real EdDSA (`jose`) implementation is gated by DL-13 / P0-E6-T1 and is out of Foundation
 * scope (DL-46); only the interface and a deny-all mock exist here.
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

/** Fail-closed default: no token is ever accepted until real auth is authorized. */
export const denyAllVerifier: AccessTokenVerifier = {
  verify() {
    return Promise.reject(new TokenVerificationError());
  },
};
