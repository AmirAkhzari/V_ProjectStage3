import { pgSchema } from 'drizzle-orm/pg-core';

/** Owned exclusively by the `ordering` module. No tables in P0 Foundation (DECISION_LOG §G F-6). */
export const orderingSchema = pgSchema('ordering');
