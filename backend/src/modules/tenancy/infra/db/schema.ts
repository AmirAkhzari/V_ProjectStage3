import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgSchema } from 'drizzle-orm/pg-core';

/** Minimal distributor directory for S-11b. RLS + FORCE (TEN-02). */
export const tenancySchema = pgSchema('tenancy');

export const distributors = tenancySchema.table('distributors', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
