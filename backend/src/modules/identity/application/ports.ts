import type { SubjectType } from '../../../platform/auth/jwt.js';

/**
 * Auth skeleton (P0-E6-T0). Real JWT/refresh/OTP/login is out of Foundation scope (DL-46, DL-13);
 * only these interfaces and in-memory mocks exist, and no login endpoint is registered.
 */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenService {
  issue(subject: { sub: string; typ: SubjectType; sid: string }): Promise<IssuedTokens>;
  revokeSession(sid: string): Promise<void>;
}

export interface OtpChallenge {
  challengeId: string;
  expiresAt: Date;
}

export type OtpVerifyResult = 'ok' | 'invalid' | 'expired' | 'locked';

export interface OtpService {
  issue(phone: string): Promise<OtpChallenge>;
  verify(challengeId: string, code: string): Promise<OtpVerifyResult>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}
