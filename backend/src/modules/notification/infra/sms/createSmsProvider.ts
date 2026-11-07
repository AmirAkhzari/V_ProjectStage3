import type { SmsProvider, SmsProviderLog } from '../../application/ports.js';
import { FakeSmsProvider } from './fakeSmsProvider.js';
import { KavenegarSmsProvider, type SmsFetch } from './kavenegar/kavenegarSmsProvider.js';

export interface SmsProviderConfig {
  SMS_PROVIDER: 'fake' | 'kavenegar';
  KAVENEGAR_API_KEY?: string;
  KAVENEGAR_TEMPLATE?: string;
  SMS_TIMEOUT_MS?: number;
}

export function createSmsProvider(
  config: SmsProviderConfig,
  deps: { fetch?: SmsFetch; log?: SmsProviderLog; fake?: FakeSmsProvider } = {},
): SmsProvider {
  if (config.SMS_PROVIDER === 'fake') {
    return deps.fake ?? new FakeSmsProvider();
  }
  const apiKey = config.KAVENEGAR_API_KEY ?? '';
  const template = config.KAVENEGAR_TEMPLATE ?? '';
  if (apiKey.length === 0 || template.length === 0) {
    throw new Error('KAVENEGAR_API_KEY and KAVENEGAR_TEMPLATE are required');
  }
  return new KavenegarSmsProvider({
    apiKey,
    template,
    ...(config.SMS_TIMEOUT_MS !== undefined ? { timeoutMs: config.SMS_TIMEOUT_MS } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  });
}
