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

/** Composition-root adapter map. Values stay `unset` until a real provider is authorized. */
export const STARTUP_ADAPTERS: Record<AdapterKind, string> = {
  sms: 'unset',
  payment: 'unset',
  kyc: 'unset',
  payout: 'unset',
  otp: 'unset',
  passwordHasher: 'unset',
  token: 'unset',
};

export function assertStartupAdapters(
  nodeEnv: string,
  adapters: Record<AdapterKind, string> = STARTUP_ADAPTERS,
): void {
  for (const kind of Object.keys(adapters) as AdapterKind[]) {
    assertAdapterAllowed(kind, adapters[kind], nodeEnv);
  }
}
