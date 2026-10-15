/** Versioned public events of the `delivery` module. Event types are gated by P0-E5-T5. */
export const DELIVERY_EVENT_TYPES = [] as const;

export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];
