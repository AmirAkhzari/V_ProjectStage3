import { doublePrecision, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pgSchema } from 'drizzle-orm/pg-core';

/** Minimal shopkeeper directory for S-11b. RLS + FORCE; DA visibility is P1 (DL-18). */
export const customersSchema = pgSchema('customers');

export const shopkeepers = customersSchema.table(
  'shopkeepers',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull(),
    phone: text('phone').notNull(),
    /** A8: the shop's display name; null until the shopkeeper saves one. */
    name: text('name'),
    primaryDistributorId: uuid('primary_distributor_id'),
    /** A10: the address A7 reports as `defaultAddressId`; null until the shop saves one. */
    defaultAddressId: uuid('default_address_id'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [unique('shopkeepers_account_id_unique').on(table.accountId)],
);

/** A9/A10: the shop's address book. FORCE RLS scopes it to `app.shopkeeper_id`. */
export const addresses = customersSchema.table('addresses', {
  id: uuid('id').primaryKey(),
  shopkeeperId: uuid('shopkeeper_id').notNull(),
  title: text('title').notNull(),
  fullAddress: text('full_address').notNull(),
  plaque: text('plaque').notNull(),
  unit: text('unit').notNull(),
  tag: text('tag'),
  branchName: text('branch_name'),
  cityName: text('city_name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  streetLabel: text('street_label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
