import { pgSchema } from 'drizzle-orm/pg-core';

/** Owned exclusively by the `notification` module. No tables in P0 Foundation (DECISION_LOG §G F-6). */
export const notificationSchema = pgSchema('notification');
