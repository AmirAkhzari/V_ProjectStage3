/** Versioned public events of the `marketing` module. Event types are gated by P0-E5-T5. */
export const MARKETING_EVENT_TYPES = [] as const;

export type MarketingEventType = (typeof MARKETING_EVENT_TYPES)[number];
