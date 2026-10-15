import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pgSchema } from 'drizzle-orm/pg-core';

/** Identity schema: `vproject_identity` only; never granted to the app (TEN-01). */
export const identitySchema = pgSchema('identity');

export const accounts = identitySchema.table(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    typ: text('typ').notNull(),
    phone: text('phone'),
    usernameNorm: text('username_norm'),
    status: text('status').notNull(),
    sessionVersion: integer('session_version').notNull().default(0),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    unique('accounts_phone_unique').on(table.phone),
    unique('accounts_username_norm_unique').on(table.usernameNorm),
    check(
      'accounts_username_norm_check',
      sql`${table.usernameNorm} = lower(${table.usernameNorm}) AND length(${table.usernameNorm}) <= 64`,
    ),
  ],
);

export const driverCredentials = identitySchema.table('driver_credentials', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  distributorId: uuid('distributor_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  tempExpiresAt: timestamp('temp_expires_at', { withTimezone: true, mode: 'date' }),
});

export const staffMemberships = identitySchema.table('staff_memberships', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  role: text('role').notNull(),
  distributorId: uuid('distributor_id'),
  permissions: text('permissions').array().notNull(),
});

export const sessions = identitySchema.table(
  'sessions',
  {
    sid: uuid('sid').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    typ: text('typ').notNull(),
    familyId: uuid('family_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    index('sessions_account_id_idx').on(table.accountId),
    index('sessions_family_id_idx').on(table.familyId),
  ],
);

export const refreshTokens = identitySchema.table(
  'refresh_tokens',
  {
    hash: text('hash').primaryKey(),
    familyId: uuid('family_id').notNull(),
    sid: uuid('sid')
      .notNull()
      .references(() => sessions.sid),
    rotatedAt: timestamp('rotated_at', { withTimezone: true, mode: 'date' }),
    /** Hash of the next refresh token in the family; never plaintext. */
    successor: text('successor'),
    /** When this token was consumed by a successful rotation. */
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    /** When a 20s grace replay of this token was honoured (once). */
    graceUsedAt: timestamp('grace_used_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_sid_idx').on(table.sid),
  ],
);
