/**
 * Idempotency-Key middleware skeleton (P0-E7-T1). The store is in-memory; it is not attached to
 * domain endpoints (none are implemented). Replay vs body-mismatch semantics follow the frozen
 * contract (`IDEMPOTENCY_KEY_REUSE`) and will be wired when those endpoints are authorized.
 */
export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number;
  response: unknown;
}

export interface IdempotencyStore {
  get(scope: string, subjectId: string, key: string): Promise<IdempotencyRecord | undefined>;
  put(scope: string, subjectId: string, key: string, record: IdempotencyRecord): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(scope: string, subjectId: string, key: string): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve(this.records.get(compound(scope, subjectId, key)));
  }

  put(scope: string, subjectId: string, key: string, record: IdempotencyRecord): Promise<void> {
    this.records.set(compound(scope, subjectId, key), record);
    return Promise.resolve();
  }
}

function compound(scope: string, subjectId: string, key: string): string {
  return `${scope}\u0000${subjectId}\u0000${key}`;
}
