import type pg from 'pg';
import type { IdempotencyRecord, IdempotencyStore } from './idempotency.js';

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(scope: string, subjectId: string, key: string): Promise<IdempotencyRecord | undefined> {
    const result = await this.pool.query<{
      request_hash: string;
      status_code: number | null;
      response: unknown;
    }>(
      `SELECT request_hash, status_code, response
       FROM platform.idempotency_keys
       WHERE scope = $1 AND subject_id = $2 AND key = $3`,
      [scope, subjectId, key],
    );
    const row = result.rows[0];
    if (!row || row.status_code === null) return undefined;
    return {
      requestHash: row.request_hash,
      statusCode: row.status_code,
      response: row.response,
    };
  }

  async put(
    scope: string,
    subjectId: string,
    key: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO platform.idempotency_keys (
         scope, subject_id, key, request_hash, response, status_code, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (scope, subject_id, key) DO UPDATE SET
         request_hash = EXCLUDED.request_hash,
         response = EXCLUDED.response,
         status_code = EXCLUDED.status_code`,
      [
        scope,
        subjectId,
        key,
        record.requestHash,
        JSON.stringify(record.response),
        record.statusCode,
      ],
    );
  }
}
