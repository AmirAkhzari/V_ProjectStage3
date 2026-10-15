/** Versioned public events of the `membership` module. Event types are gated by P0-E5-T5. */
export const MEMBERSHIP_EVENT_TYPES = [] as const;

export type MembershipEventType = (typeof MEMBERSHIP_EVENT_TYPES)[number];
