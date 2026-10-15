/**
 * Composition-root guard (M-5). Mock adapters exist for tests only. Selecting `mock` in
 * production must fail closed at startup, before any request is served.
 */
export type AdapterKind = 'sms' | 'payment' | 'kyc' | 'payout' | 'otp' | 'passwordHasher' | 'token';

export function assertAdapterAllowed(
  kind: AdapterKind,
  implementation: string,
  nodeEnv: string,
): void {
  if (nodeEnv === 'production' && implementation === 'mock') {
    throw new Error(`${kind} mock adapter cannot be selected when NODE_ENV=production`);
  }
}
