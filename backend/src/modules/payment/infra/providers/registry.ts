import type { PaymentProvider } from '../../application/ports.js';
import { MockPaymentProvider } from './mock.js';

/**
 * The process-wide provider table. A15's `request`, A36's re-use of the same authority and S3's
 * `verify` must all talk to the same instance, because the mock keeps its authority→verified map in
 * memory; a second instance would reject every callback the first one issued.
 *
 * A real PSP (DL-07 Zarinpal) registers itself here with its own name; the payment row stores that
 * name, so a row issued by one provider can never be settled through another.
 */
const mockPaymentProvider = new MockPaymentProvider();

const providers = new Map<string, PaymentProvider>([
  [mockPaymentProvider.name, mockPaymentProvider],
]);

/** The provider new intents are opened with until a PSP is configured. */
export const DEFAULT_PAYMENT_PROVIDER = mockPaymentProvider.name;

export function findPaymentProvider(name: string): PaymentProvider | undefined {
  return providers.get(name);
}

export function defaultPaymentProvider(): PaymentProvider {
  return mockPaymentProvider;
}
