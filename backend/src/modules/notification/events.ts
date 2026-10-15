/** Versioned public events of the `notification` module. Event types are gated by P0-E5-T5. */
export const NOTIFICATION_EVENT_TYPES = [] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
