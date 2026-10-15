import type pg from 'pg';
import type { Redis } from 'ioredis';

export type DependencyStatus = 'up' | 'down';

export interface DependencyCheckResult {
  status: DependencyStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthCheck {
  name: string;
  check(): Promise<void>;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, DependencyCheckResult>;
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
      } catch (error) {
        return [
          hc.name,
          {
            status: 'down',
            latencyMs: Math.round(performance.now() - started),
            error: error instanceof Error ? error.message : 'unknown error',
          },
        ];
      }
    }),
  );
  const results = Object.fromEntries(entries);
  const allUp = entries.every(([, r]) => r.status === 'up');
  return { status: allUp ? 'ok' : 'degraded', checks: results };
}

export function postgresHealthCheck(pool: pg.Pool): HealthCheck {
  return {
    name: 'postgres',
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
