import { randomBytes } from 'node:crypto';

/** C11 — the only driver route allowed while `must_change_password` (AUTH-PW-04). */
export const DRIVER_PASSWORD_CHANGE_PATH = '/v1/driver/auth/password';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const TEMP_PASSWORD_MIN_LENGTH = 12;
export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export type PasswordPolicyCode =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_BREACHED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'PASSWORD_CONTAINS_IDENTITY'
  | 'USERNAME_TAKEN';

export interface PasswordIdentity {
  username?: string;
  distributorName?: string;
}

export class PasswordPolicyError extends Error {
  readonly code: PasswordPolicyCode;

  constructor(code: PasswordPolicyCode, message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
    this.code = code;
  }
}

export function normalizePassword(plain: string): string {
  return plain.normalize('NFKC');
}

export type PasswordCheck =
  | { ok: true; normalized: string }
  | { ok: false; code: Exclude<PasswordPolicyCode, 'PASSWORD_CHANGE_REQUIRED'> };

/** R12-7 / 9-4: username must not equal a distributor name (password-set, not login). */
export function usernameCollidesWithDistributor(
  username: string,
  distributorName: string,
): boolean {
  const left = username.trim().normalize('NFKC').toLowerCase();
  const right = distributorName.trim().normalize('NFKC').toLowerCase();
  return left.length > 0 && left === right;
}

export function assertUsernameAvailable(username: string, distributorName: string): void {
  if (usernameCollidesWithDistributor(username, distributorName)) {
    throw new PasswordPolicyError('USERNAME_TAKEN', 'USERNAME_TAKEN');
  }
}

function containsIdentity(normalized: string, identity?: PasswordIdentity): boolean {
  const haystack = normalized.toLowerCase();
  for (const raw of [identity?.username, identity?.distributorName]) {
    if (!raw) continue;
    const needle = raw.trim().normalize('NFKC').toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) return true;
  }
  return false;
}

export function evaluateNewPassword(
  plain: string,
  isBreached: (normalized: string) => boolean,
  identity?: PasswordIdentity,
): PasswordCheck {
  const normalized = normalizePassword(plain);
  if (normalized.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, code: 'PASSWORD_TOO_SHORT' };
  }
  if (normalized.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, code: 'PASSWORD_TOO_LONG' };
  }
  if (isBreached(normalized)) {
    return { ok: false, code: 'PASSWORD_BREACHED' };
  }
  if (containsIdentity(normalized, identity)) {
    return { ok: false, code: 'PASSWORD_CONTAINS_IDENTITY' };
  }
  if (
    identity?.username &&
    identity.distributorName &&
    usernameCollidesWithDistributor(identity.username, identity.distributorName)
  ) {
    return { ok: false, code: 'USERNAME_TAKEN' };
  }
  return { ok: true, normalized };
}

export function assertNewPassword(
  plain: string,
  isBreached: (normalized: string) => boolean,
  identity?: PasswordIdentity,
): string {
  const result = evaluateNewPassword(plain, isBreached, identity);
  if (!result.ok) {
    throw new PasswordPolicyError(result.code, result.code);
  }
  return result.normalized;
}

export function isDriverRouteAllowed(mustChangePassword: boolean, path: string): boolean {
  if (!mustChangePassword) return true;
  return path === DRIVER_PASSWORD_CHANGE_PATH;
}

export function assertDriverRouteAllowed(mustChangePassword: boolean, path: string): void {
  if (!isDriverRouteAllowed(mustChangePassword, path)) {
    throw new PasswordPolicyError(
      'PASSWORD_CHANGE_REQUIRED',
      'Only the password-change route is allowed',
    );
  }
}

export interface TempCredential {
  password: string;
  mustChangePassword: true;
  tempExpiresAt: Date;
}

/** System-generated one-time password: ≥12 CSPRNG chars, 72h, must_change_password (AUTH-PW-03). */
export function generateTempCredential(
  now: Date,
  isBreached: (normalized: string) => boolean = () => false,
): TempCredential {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const password = randomChars(TEMP_PASSWORD_MIN_LENGTH);
    const check = evaluateNewPassword(password, isBreached);
    if (check.ok) {
      return {
        password: check.normalized,
        mustChangePassword: true,
        tempExpiresAt: new Date(now.getTime() + TEMP_PASSWORD_TTL_MS),
      };
    }
  }
  throw new PasswordPolicyError(
    'PASSWORD_BREACHED',
    'could not generate a non-breached temp password',
  );
}

function randomChars(length: number): string {
  const alphabetLen = TEMP_ALPHABET.length;
  const rejectAt = 256 - (256 % alphabetLen);
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length);
    for (const byte of bytes) {
      if (byte >= rejectAt) continue;
      const ch = TEMP_ALPHABET[byte % alphabetLen];
      if (ch === undefined) throw new Error('alphabet underflow');
      out += ch;
      if (out.length === length) break;
    }
  }
  return out;
}
