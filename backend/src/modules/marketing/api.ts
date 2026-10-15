/**
 * Public synchronous API of the `marketing` module (§9.3 rules 1 and 5). Together with `events.ts` this
 * is the only file other modules may import. Operations take an optional transaction so callers can
 * compose them atomically; none are defined until the module's phase is authorized.
 */
export type MarketingApi = Readonly<Record<never, never>>;

export function createMarketingApi(): MarketingApi {
  return {};
}
