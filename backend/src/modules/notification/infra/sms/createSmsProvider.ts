import { KAVENEGAR_PLACEHOLDER_KEYS } from '../../../../platform/config.js';
import type { SmsProvider, SmsProviderLog } from '../../application/ports.js';
import { FakeSmsProvider } from './fakeSmsProvider.js';
import {
  KAVENEGAR_TEMPLATE_RE,
  KavenegarSmsProvider,
  type SmsFetch,
} from './kavenegar/kavenegarSmsProvider.js';
import { SilentSmsProvider } from './silentSmsProvider.js';

export { KAVENEGAR_PLACEHOLDER_KEYS };

export interface SmsProviderConfig {
  SMS_PROVIDER: 'fake' | 'kavenegar';
  SMS_LIVE_SEND?: boolean;
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
  if (config.SMS_LIVE_SEND !== true) {
    deps.log?.warn?.({ smsReason: 'disabled' }, 'sms live send disabled; silent provider');
    return new SilentSmsProvider();
  }
  const apiKey = config.KAVENEGAR_API_KEY ?? '';
  const template = config.KAVENEGAR_TEMPLATE ?? '';
  if (apiKey.length === 0 || KAVENEGAR_PLACEHOLDER_KEYS.has(apiKey)) {
    throw new Error('KAVENEGAR_API_KEY is missing or a placeholder; live send refused');
  }
  if (!KAVENEGAR_TEMPLATE_RE.test(template)) {
    throw new Error('KAVENEGAR_TEMPLATE failed documented validation');
  }
  return new KavenegarSmsProvider({
    apiKey,
    template,
    ...(config.SMS_TIMEOUT_MS !== undefined ? { timeoutMs: config.SMS_TIMEOUT_MS } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  });
}
