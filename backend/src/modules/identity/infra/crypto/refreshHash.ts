import { createHash, randomBytes } from 'node:crypto';

/** Opaque refresh token: ≥256-bit CSPRNG, base64url (≥43 chars, AUTH-RT-01 / OpenAPI). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Server-side storage is always a hash; never persist plaintext (AUTH-RT-05). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
