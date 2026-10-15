import { pgSchema } from 'drizzle-orm/pg-core';

/** `platform` schema. Infrastructure tables (outbox, inbox, audit, idempotency) are not yet authorized. */
export const platformSchema = pgSchema('platform');
