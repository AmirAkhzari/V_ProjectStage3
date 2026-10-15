/** Versioned public events of the `customers` module. Event types are gated by P0-E5-T5. */
export const CUSTOMERS_EVENT_TYPES = [] as const;

export type CustomersEventType = (typeof CUSTOMERS_EVENT_TYPES)[number];
