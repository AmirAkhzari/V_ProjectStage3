/** Versioned public events of the `reporting` module. Event types are gated by P0-E5-T5. */
export const REPORTING_EVENT_TYPES = [] as const;

export type ReportingEventType = (typeof REPORTING_EVENT_TYPES)[number];
