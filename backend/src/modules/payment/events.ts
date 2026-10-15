/** Versioned public events of the `payment` module. Event types are gated by P0-E5-T5. */
export const PAYMENT_EVENT_TYPES = [] as const;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];
