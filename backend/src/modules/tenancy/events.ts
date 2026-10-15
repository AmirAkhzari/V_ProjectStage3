/** Versioned public events of the `tenancy` module. Event types are gated by P0-E5-T5. */
export const TENANCY_EVENT_TYPES = [] as const;

export type TenancyEventType = (typeof TENANCY_EVENT_TYPES)[number];
