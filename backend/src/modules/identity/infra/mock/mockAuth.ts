import { randomUUID } from 'node:crypto';
import type {
  IssuedTokens,
  OtpChallenge,
  OtpService,
  OtpVerifyResult,
  PasswordHasher,
  TokenService,
} from '../../application/ports.js';

/** Test double. Tokens are opaque random strings and are never accepted by the route guards. */
export class MockTokenService implements TokenService {
  readonly revoked = new Set<string>();

  issue(_subject: {
    sub: string;
    typ: 'shopkeeper' | 'staff' | 'driver';
    sid: string;
  }): Promise<IssuedTokens> {
    return Promise.resolve({
      accessToken: `mock-${randomUUID()}`,
      refreshToken: `mock-${randomUUID()}`,
    });
  }

  revokeSession(sid: string): Promise<void> {
    this.revoked.add(sid);
    return Promise.resolve();
  }
}

interface MockChallenge {
  code: string;
  expiresAt: Date;
  attempts: number;
}

/** In-memory OTP double with an injected code generator; holds no real secrets. */
export class MockOtpService implements OtpService {
  private readonly challenges = new Map<string, MockChallenge>();

  constructor(
    private readonly options: {
      generateCode: () => string;
      ttlMs: number;
      maxAttempts: number;
      now?: () => Date;
    },
  ) {}

  issue(_phone: string): Promise<OtpChallenge> {
    const challengeId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.options.ttlMs);
    this.challenges.set(challengeId, { code: this.options.generateCode(), expiresAt, attempts: 0 });
    return Promise.resolve({ challengeId, expiresAt });
  }

  verify(challengeId: string, code: string): Promise<OtpVerifyResult> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return Promise.resolve('invalid');
    if (challenge.attempts >= this.options.maxAttempts) return Promise.resolve('locked');
    if (challenge.expiresAt <= this.now()) return Promise.resolve('expired');
    challenge.attempts += 1;
    if (challenge.code !== code) return Promise.resolve('invalid');
    this.challenges.delete(challengeId);
    return Promise.resolve('ok');
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

/** NOT a password hash. Forbidden in production (brief §6.6). */
export class InsecureMockPasswordHasher implements PasswordHasher {
  constructor(nodeEnv: string | undefined = process.env['NODE_ENV']) {
    if (nodeEnv === 'production') {
      throw new Error('mock password hasher is forbidden in production');
    }
  }

  hash(plain: string): Promise<string> {
    return Promise.resolve(`mock$${Buffer.from(plain).toString('base64url')}`);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return Promise.resolve(hash === `mock$${Buffer.from(plain).toString('base64url')}`);
  }
}
