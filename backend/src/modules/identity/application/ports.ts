import type { SubjectType } from '../../../platform/auth/jwt.js';

/**
 * Auth ports. S11b-2 wires argon2id, EdDSA JWT, and the refresh-token store.
 * Login HTTP remains S11b-4; OTP remains S11b-5. Mocks stay unwired.
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
