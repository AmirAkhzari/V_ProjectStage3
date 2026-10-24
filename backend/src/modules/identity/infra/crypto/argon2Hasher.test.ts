import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_PASSWORD_HASH } from '../../../../../scripts/seed.js';
import { Argon2idPasswordHasher } from './argon2Hasher.js';

describe('Argon2idPasswordHasher', () => {
  const hasher = new Argon2idPasswordHasher();

  it('AUTH-PW-01: hashes with argon2id m=19456 t=2 p=1 and verifies the matching password', async () => {
    const hash = await hasher.hash('correct-horse-battery');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(hash).toMatch(/m=19456/);
    expect(hash).toMatch(/t=2/);
    expect(hash).toMatch(/p=1/);
    expect(await hasher.verify(hash, 'correct-horse-battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong-password')).toBe(false);
  });

  it('AUTH-PW-01: NFKC-normalises before hash and verify', async () => {
    const hash = await hasher.hash('ﬁleword12');
    expect(await hasher.verify(hash, 'fileword12')).toBe(true);
    expect(await hasher.verify(hash, 'ﬁleword12')).toBe(true);
  });

  it('AUTH-PW-01: rejects the seed placeholder hash and any non-$argon2id$ string', async () => {
    expect(PLACEHOLDER_PASSWORD_HASH.startsWith('$argon2id$')).toBe(false);
    expect(await hasher.verify(PLACEHOLDER_PASSWORD_HASH, 'anything')).toBe(false);
    expect(await hasher.verify('seed-placeholder-hash', 'secret')).toBe(false);
    expect(await hasher.verify('mock$c2VjcmV0', 'secret')).toBe(false);
    expect(await hasher.verify('$argon2i$v=19$m=19456,t=2,p=1$YWFh$YmJi', 'secret')).toBe(false);
    expect(await hasher.verify('', 'secret')).toBe(false);
  });
});
