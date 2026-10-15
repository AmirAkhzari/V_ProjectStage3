import type pg from 'pg';
import type { InboxStore } from './inbox.js';

/** Consumer idempotency against `platform.inbox_processed` (PK consumer, event_id). */
export class PgInboxStore implements InboxStore {
  constructor(private readonly pool: pg.Pool) {}

  async runOnce(consumer: string, eventId: string, effect: () => Promise<void>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO platform.inbox_processed (consumer, event_id, processed_at)
         VALUES ($1, $2, now())
         ON CONFLICT (consumer, event_id) DO NOTHING`,
        [consumer, eventId],
      );
      if ((inserted.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await effect();
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
