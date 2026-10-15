/**
 * Idempotency-Key store (P0-E7-T1 / Architect N-9). `PgIdempotencyStore` persists
 * `platform.idempotency_keys`. Not attached to domain endpoints yet.
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
