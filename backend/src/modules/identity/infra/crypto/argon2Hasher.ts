import argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports.js';
import { normalizePassword } from '../../domain/passwordPolicy.js';

/** AUTH-PW-01 / DL-09: argon2id m=19456 KiB, t=2, p=1. */
export const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const ARGON2ID_PREFIX = '$argon2id$';

export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return argon2.hash(normalizePassword(plain), ARGON2ID_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    if (!hash.startsWith(ARGON2ID_PREFIX)) return false;
    try {
      return await argon2.verify(hash, normalizePassword(plain));
    } catch {
      return false;
    }
  }
}
