/**
 * Public synchronous API of the `delivery` module (§9.3 rules 1 and 5). Together with `events.ts` this
 * is the only file other modules may import. Operations take an optional transaction so callers can
 * compose them atomically; none are defined until the module's phase is authorized.
 */
export type DeliveryApi = Readonly<Record<never, never>>;

export function createDeliveryApi(): DeliveryApi {
  return {};
}
