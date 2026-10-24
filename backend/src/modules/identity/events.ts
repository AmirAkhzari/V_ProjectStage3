import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '../../platform/events/envelope.js';

/** Versioned public events of the `identity` module. Event types are gated by P0-E5-T5. */
export const IDENTITY_EVENT_TYPES = ['identity.sessions_revoked'] as const;

export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];

export const SESSIONS_REVOKED_EVENT = 'identity.sessions_revoked' as const;
export const SESSIONS_REVOKED_EVENT_VERSION = 1;
export const REFRESH_REUSE_AUDIT_ACTION = 'refresh_reuse';
/** AppSec RC-1 / N9-2: not `refresh_grace`. */
export const REFRESH_GRACE_AUDIT_ACTION = 'refresh_grace_replay';

export interface SessionsRevokedPayload {
  familyId: string;
  sid: string;
  accountId: string;
  reason: 'refresh_reuse';
}

export function sessionsRevokedEvent(
  input: SessionsRevokedPayload,
  occurredAt: Date,
): EventEnvelope<typeof SESSIONS_REVOKED_EVENT, SessionsRevokedPayload> {
  return {
    id: randomUUID(),
    type: SESSIONS_REVOKED_EVENT,
    version: SESSIONS_REVOKED_EVENT_VERSION,
    aggregateType: 'session',
    aggregateId: input.familyId,
    distributorId: null,
    occurredAt,
    payload: input,
  };
}
