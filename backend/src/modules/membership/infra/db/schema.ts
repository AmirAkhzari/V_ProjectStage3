import { pgSchema } from 'drizzle-orm/pg-core';

/** Owned exclusively by the `membership` module. No tables in P0 Foundation (DECISION_LOG §G F-6). */
export const membershipSchema = pgSchema('membership');
