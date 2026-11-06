import type pg from 'pg';
import { drainPendingDenies, type DrainLog } from '../infra/session/pgSessionStore.js';

export const DRAIN_ABANDON_ATTEMPTS = 3;
export const DRAIN_STUCK_MS = 60_000;
export const DRAIN_PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingDenyTick {
  drained: boolean;
  abandoned: number;
  oldestAgeMs: number;
  purged: number;
}

export async function countAbandonedPendingDenies(
  pool: pg.Pool,
  stuckMs = DRAIN_STUCK_MS,
): Promise<{ count: number; oldestAgeMs: number }> {
  const found = await pool.query<{ n: string; oldest_ms: string | null }>(
    `SELECT count(*)::text AS n,
            EXTRACT(EPOCH FROM (now() - min(enqueued_at))) * 1000 AS oldest_ms
       FROM identity.pending_session_denies
      WHERE done_at IS NULL
        AND (attempts >= $2 OR enqueued_at < now() - ($1::int * interval '1 millisecond'))`,
    [stuckMs, DRAIN_ABANDON_ATTEMPTS],
  );
  return {
    count: Number(found.rows[0]?.n ?? 0),
    oldestAgeMs: Number(found.rows[0]?.oldest_ms ?? 0),
  };
}

export async function purgeDonePendingDenies(
  pool: pg.Pool,
  olderThanMs = DRAIN_PURGE_AFTER_MS,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM identity.pending_session_denies
      WHERE done_at IS NOT NULL
        AND done_at < now() - ($1::int * interval '1 millisecond')`,
    [olderThanMs],
  );
  return result.rowCount ?? 0;
}

export async function runPendingDenyTick(
  pool: pg.Pool,
  deny: (sids: readonly string[]) => Promise<void>,
  log: DrainLog,
): Promise<PendingDenyTick> {
  await drainPendingDenies(pool, deny, log);
  let abandoned = { count: 0, oldestAgeMs: 0 };
  try {
    abandoned = await countAbandonedPendingDenies(pool);
    if (abandoned.count > 0) {
      (log.warn ?? log.error)(
        { abandoned: abandoned.count, oldestAgeMs: abandoned.oldestAgeMs },
        'pending deny backlog',
      );
    }
  } catch (error) {
    log.error({ err: error }, 'pending deny backlog metric failed');
  }
  let purged = 0;
  try {
    purged = await purgeDonePendingDenies(pool);
  } catch (error) {
    log.error({ err: error }, 'pending deny purge failed');
  }
  return {
    drained: true,
    abandoned: abandoned.count,
    oldestAgeMs: abandoned.oldestAgeMs,
    purged,
  };
}

export function startPendingDenyWorker(input: {
  pool: pg.Pool;
  deny: (sids: readonly string[]) => Promise<void>;
  log: DrainLog;
  intervalMs: number;
}): () => void {
  const tick = () => {
    void runPendingDenyTick(input.pool, input.deny, input.log);
  };
  tick();
  const timer = setInterval(tick, input.intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
