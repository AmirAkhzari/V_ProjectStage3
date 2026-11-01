/** AUTH-LG-01 / 9-3 / 9-10. Username and password are normalised only after these caps. */
export const USERNAME_MAX_CHARS = 64;
export const PASSWORD_MAX_BYTES = 128;
export const LOGIN_FAILURES_TO_LOCK = 5;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;
export const LOGIN_RATE_USER = 10;
export const LOGIN_RATE_IP = 30;
export const LOGIN_RATE_WINDOW_SECONDS = 60;
export const DRIVER_MAX_SESSIONS = 3;

/** Dummy argon2id (m=19456,t=2,p=1) so a missing row still pays verify (9-10). */
export const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$nWMgUSiRSVjHbQH2ARANjw$VYaQXSFO+FTE33HNpPVjjP+8nArBtQ9dFowV21DROEY';

export function normalizeUsername(raw: string): string {
  return raw.trim().normalize('NFKC').toLowerCase().slice(0, USERNAME_MAX_CHARS);
}

/** Cap in UTF-8 bytes before NFKC or hashing (9-3). */
export function capPasswordBytes(raw: string): string {
  const bytes = Buffer.from(raw, 'utf8');
  if (bytes.length <= PASSWORD_MAX_BYTES) return raw;
  return bytes.subarray(0, PASSWORD_MAX_BYTES).toString('utf8');
}
