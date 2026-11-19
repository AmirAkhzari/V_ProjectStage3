/**
 * Idempotency-Key store (P0-E7-T1 / Architect N-9). `claim` takes an in-progress row
 * (status_code NULL); `complete` fills it with the stored response.
 */
export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number;
  response: unknown;
}

/** Minimal query surface so `complete` can share a transaction client. */
export interface IdempotencyExecutor {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export type IdempotencyClaim =
  | { status: 'claimed' }
  | { status: 'completed'; record: IdempotencyRecord }
  | { status: 'in_progress'; retryAfter: number };

export interface IdempotencyStore {
  get(scope: string, subjectId: string, key: string): Promise<IdempotencyRecord | undefined>;
  put(scope: string, subjectId: string, key: string, record: IdempotencyRecord): Promise<void>;
  /** Atomically take an absent or stale in-progress row. */
  claim(scope: string, subjectId: string, key: string, hash: string): Promise<IdempotencyClaim>;
  complete(
    scope: string,
    subjectId: string,
    key: string,
    record: IdempotencyRecord,
    executor?: IdempotencyExecutor,
  ): Promise<void>;
  /** Drop our in-progress row after a failure so the key can be retried. */
  abandon(scope: string, subjectId: string, key: string): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly inProgress = new Map<string, { requestHash: string; at: number }>();

  get(scope: string, subjectId: string, key: string): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve(this.records.get(compound(scope, subjectId, key)));
  }

  put(scope: string, subjectId: string, key: string, record: IdempotencyRecord): Promise<void> {
    this.records.set(compound(scope, subjectId, key), record);
    return Promise.resolve();
  }

  claim(scope: string, subjectId: string, key: string, hash: string): Promise<IdempotencyClaim> {
    const id = compound(scope, subjectId, key);
    const done = this.records.get(id);
    if (done) return Promise.resolve({ status: 'completed', record: done });
    const pending = this.inProgress.get(id);
    // Same 30s takeover window as PgIdempotencyStore.
    if (pending && Date.now() - pending.at < 30_000) {
      return Promise.resolve({ status: 'in_progress', retryAfter: 5 });
    }
    this.inProgress.set(id, { requestHash: hash, at: Date.now() });
    return Promise.resolve({ status: 'claimed' });
  }

  complete(scope: string, subjectId: string, key: string, record: IdempotencyRecord) {
    const id = compound(scope, subjectId, key);
    this.inProgress.delete(id);
    this.records.set(id, record);
    return Promise.resolve();
  }

  abandon(scope: string, subjectId: string, key: string): Promise<void> {
    this.inProgress.delete(compound(scope, subjectId, key));
    return Promise.resolve();
  }
}

function compound(scope: string, subjectId: string, key: string): string {
  return `${scope}\u0000${subjectId}\u0000${key}`;
}
