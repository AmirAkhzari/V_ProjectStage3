/** Versioned public events of the `ordering` module. Event types are gated by P0-E5-T5. */
export const ORDERING_EVENT_TYPES = [] as const;

export type OrderingEventType = (typeof ORDERING_EVENT_TYPES)[number];
