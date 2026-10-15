import type pg from 'pg';
import type { Redis } from 'ioredis';

export type DependencyStatus = 'up' | 'down';

export interface DependencyCheckResult {
  status: DependencyStatus;
  latencyMs: number;
}

export interface HealthCheck {
  name: string;
  check(): Promise<void>;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, DependencyCheckResult>;
}

export interface HealthSink {
  warn(bindings: Record<string, unknown>, message: string): void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runHealthChecks(
  checks: readonly HealthCheck[],
  timeoutMs: number,
): Promise<HealthReport> {
  const entries = await Promise.all(
    checks.map(async (hc): Promise<[string, DependencyCheckResult]> => {
      const started = performance.now();
      try {
        await withTimeout(hc.check(), timeoutMs);
        return [hc.name, { status: 'up', latencyMs: Math.round(performance.now() - started) }];
      } catch {
        return [hc.name, { status: 'down', latencyMs: Math.round(performance.now() - started) }];
      }
    }),
  );
  const allUp = entries.every(([, r]) => r.status === 'up');
  return { status: allUp ? 'ok' : 'degraded', checks: Object.fromEntries(entries) };
}

export interface HealthMonitorOptions {
  checks: readonly HealthCheck[];
  timeoutMs: number;
  /** Cache TTL in ms. AppSec M-3b: about 1–2 s. */
  ttlMs?: number;
  now?: () => number;
  log?: HealthSink;
}

/** Caches probe results so unauthenticated `/health` and `/ready` do not hammer dependencies. */
export class HealthMonitor {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cached: { at: number; report: HealthReport } | undefined;

  constructor(private readonly options: HealthMonitorOptions) {
    this.ttlMs = options.ttlMs ?? 1500;
    this.now = options.now ?? (() => Date.now());
  }

  async snapshot(): Promise<HealthReport> {
    const now = this.now();
    if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.report;
    const report = await runHealthChecks(this.options.checks, this.options.timeoutMs);
    this.cached = { at: now, report };
    if (report.status === 'degraded') {
      const down = Object.entries(report.checks)
        .filter(([, r]) => r.status === 'down')
        .map(([name]) => name);
      this.options.log?.warn({ down }, 'dependency probe degraded');
    }
    return report;
  }
}

export function postgresHealthCheck(pool: pg.Pool, name = 'postgres'): HealthCheck {
  return {
    name,
    async check() {
      await pool.query('SELECT 1');
    },
  };
}

export function redisHealthCheck(redis: Redis): HealthCheck {
  return {
    name: 'redis',
    async check() {
      if (redis.status === 'wait' || redis.status === 'close' || redis.status === 'end') {
        await redis.connect();
      }
      const reply = await redis.ping();
      if (reply !== 'PONG') throw new Error(`unexpected PING reply: ${reply}`);
    },
  };
}

/**
 * Readiness lag probe (arch §11). Calls `platform.outbox_lag_exceeded`, a SECURITY DEFINER
 * boolean owned by the migrator, so `vproject_app` does not SELECT outbox payloads (AppSec N-2).
 */
export function outboxLagHealthCheck(pool: pg.Pool, maxLagMs: number): HealthCheck {
  return {
    name: 'outbox_lag',
    async check() {
      const result = await pool.query<{ lagged: boolean }>(
        `SELECT platform.outbox_lag_exceeded($1::int) AS lagged`,
        [maxLagMs],
      );
      if (result.rows[0]?.lagged) {
        throw new Error('outbox lag exceeded threshold');
      }
    },
  };
}
