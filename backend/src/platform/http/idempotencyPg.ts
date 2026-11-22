import type pg from 'pg';
import type {
  IdempotencyClaim,
  IdempotencyExecutor,
  IdempotencyRecord,
  IdempotencyStore,
} from './idempotency.js';

/** An in-progress row older than this may be taken over after a crashed request. */
const TAKEOVER_SECONDS = 30;
type StoredRow = { request_hash: string; status_code: number | null; response: unknown };

/** 0023's policies read app.subject_id; it must be set in the same tx as the statement. */
const SET_SUBJECT = `SELECT set_config('app.subject_id', $1, true)`;

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Every statement runs with `app.subject_id` set in the same transaction. With a caller executor
   * (B27/B83 tenant tx) the setting lands on that transaction first; otherwise one client is checked
   * out for BEGIN … COMMIT so the policies never see a missing GUC.
   */
  private async run<T>(
    subjectId: string,
    executor: IdempotencyExecutor | undefined,
    fn: (q: IdempotencyExecutor) => Promise<T>,
  ): Promise<T> {
    if (executor) {
      await executor.query(SET_SUBJECT, [subjectId]);
      return fn(executor);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SET_SUBJECT, [subjectId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async get(scope: string, subjectId: string, key: string): Promise<IdempotencyRecord | undefined> {
    return this.run(subjectId, undefined, async (q) => {
      const result = (await q.query(
        `SELECT request_hash, status_code, response
         FROM platform.idempotency_keys
         WHERE scope = $1 AND subject_id = $2 AND key = $3`,
        [scope, subjectId, key],
      )) as pg.QueryResult<StoredRow>;
      const row = result.rows[0];
      if (!row || row.status_code === null) return undefined;
      return {
        requestHash: row.request_hash,
        statusCode: row.status_code,
        response: row.response,
      };
    });
  }

  async put(
    scope: string,
    subjectId: string,
    key: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    await this.run(subjectId, undefined, async (q) => {
      await q.query(
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
    });
  }

  async claim(
    scope: string,
    sub: string,
    key: string,
    hash: string,
    executor?: IdempotencyExecutor,
  ): Promise<IdempotencyClaim> {
    return this.run(sub, executor, async (q) => {
      // Insert, or take over only a stale in-progress row (crashed request).
      const taken = (await q.query(
        `INSERT INTO platform.idempotency_keys (scope, subject_id, key, request_hash, created_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (scope, subject_id, key) DO UPDATE
           SET request_hash = EXCLUDED.request_hash, created_at = now()
           WHERE platform.idempotency_keys.status_code IS NULL
             AND platform.idempotency_keys.created_at < now() - make_interval(secs => $5)
         RETURNING 1`,
        [scope, sub, key, hash, TAKEOVER_SECONDS],
      )) as pg.QueryResult;
      if (taken.rowCount === 1) return { status: 'claimed' };
      const existing = (await q.query(
        `SELECT request_hash, status_code, response FROM platform.idempotency_keys
          WHERE scope = $1 AND subject_id = $2 AND key = $3`,
        [scope, sub, key],
      )) as pg.QueryResult<StoredRow>;
      const row = existing.rows[0];
      if (!row) throw new Error('idempotency claim lost its row');
      if (row.status_code === null) return { status: 'in_progress', retryAfter: 5 };
      const record: IdempotencyRecord = {
        requestHash: row.request_hash,
        statusCode: row.status_code,
        response: row.response,
      };
      return { status: 'completed', record };
    });
  }

  async complete(
    scope: string,
    subjectId: string,
    key: string,
    record: IdempotencyRecord,
    executor?: IdempotencyExecutor,
  ): Promise<void> {
    await this.run(subjectId, executor, async (q) => {
      await q.query(
        `UPDATE platform.idempotency_keys
            SET request_hash = $4, response = $5, status_code = $6
          WHERE scope = $1 AND subject_id = $2 AND key = $3`,
        [
          scope,
          subjectId,
          key,
          record.requestHash,
          JSON.stringify(record.response),
          record.statusCode,
        ],
      );
    });
  }

  async abandon(
    scope: string,
    subjectId: string,
    key: string,
    executor?: IdempotencyExecutor,
  ): Promise<void> {
    await this.run(subjectId, executor, async (q) => {
      // P7-3: 0011 grants no DELETE; '-infinity' makes the next claim take the row over now.
      await q.query(
        `UPDATE platform.idempotency_keys SET created_at = '-infinity'
          WHERE scope = $1 AND subject_id = $2 AND key = $3 AND status_code IS NULL`,
        [scope, subjectId, key],
      );
    });
  }
}
