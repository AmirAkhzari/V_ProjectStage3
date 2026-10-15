/**
 * Versioned event envelope (§5.1). Payloads carry identifiers only and never OTPs or delivery
 * codes in plaintext. The 34 concrete event types are gated by P0-E5-T5 and are not defined here.
 */
export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  version: number;
  aggregateType: string;
  aggregateId: string;
  distributorId: string | null;
  occurredAt: Date;
  payload: TPayload;
}
