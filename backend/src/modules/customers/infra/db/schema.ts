import { text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pgSchema } from 'drizzle-orm/pg-core';

/** Minimal shopkeeper directory for S-11b. RLS + FORCE; DA visibility is P1 (DL-18). */
export const customersSchema = pgSchema('customers');

export const shopkeepers = customersSchema.table(
  'shopkeepers',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull(),
    phone: text('phone').notNull(),
    primaryDistributorId: uuid('primary_distributor_id'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [unique('shopkeepers_account_id_unique').on(table.accountId)],
);
