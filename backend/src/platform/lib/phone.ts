/** Phone normalization is deferred to identity/OTP work (P0-E6). Shape-only helper. */
export type E164Phone = string;

export function assertNonEmptyPhone(value: string): E164Phone {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('phone must not be empty');
  return trimmed;
}
