import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pgSchema } from 'drizzle-orm/pg-core';

/** Platform infrastructure schema (arch §3.2). Domain tables stay out of Foundation. */
export const platformSchema = pgSchema('platform');

export const outboxEvents = platformSchema.table(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    distributorId: uuid('distributor_id'),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('outbox_events_unpublished_idx')
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`),
  ],
);

export const inboxProcessed = platformSchema.table(
  'inbox_processed',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.consumer, table.eventId] })],
);

export const auditLog = platformSchema.table('audit_log', {
  id: uuid('id').primaryKey(),
  at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  distributorId: uuid('distributor_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data').notNull(),
  ip: text('ip'),
});

export const idempotencyKeys = platformSchema.table(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    subjectId: text('subject_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    statusCode: integer('status_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    unique('idempotency_keys_scope_subject_key').on(table.scope, table.subjectId, table.key),
  ],
);
