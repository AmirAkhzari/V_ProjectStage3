import { pgSchema } from 'drizzle-orm/pg-core';

/** Owned exclusively by the `catalog` module. No tables in P0 Foundation (DECISION_LOG §G F-6). */
export const catalogSchema = pgSchema('catalog');
