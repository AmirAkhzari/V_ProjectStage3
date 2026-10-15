/** Versioned public events of the `catalog` module. Event types are gated by P0-E5-T5. */
export const CATALOG_EVENT_TYPES = [] as const;

export type CatalogEventType = (typeof CATALOG_EVENT_TYPES)[number];
