import { pgSchema } from 'drizzle-orm/pg-core';

/** Owned exclusively by the `customers` module. No tables in P0 Foundation (DECISION_LOG §G F-6). */
export const customersSchema = pgSchema('customers');
