/** Versioned public events of the `identity` module. Event types are gated by P0-E5-T5. */
export const IDENTITY_EVENT_TYPES = [] as const;

export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];
