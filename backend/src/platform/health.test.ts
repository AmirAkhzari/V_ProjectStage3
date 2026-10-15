import { describe, expect, it } from 'vitest';
import { HealthMonitor } from './health.js';

describe('HealthMonitor', () => {
  it('caches probe results for the TTL window', async () => {
    let calls = 0;
    let now = 1_000;
    const monitor = new HealthMonitor({
      checks: [
        {
          name: 'postgres',
          check: async () => {
            calls += 1;
          },
        },
      ],
      timeoutMs: 200,
      ttlMs: 1500,
      now: () => now,
    });
    await monitor.snapshot();
    await monitor.snapshot();
    expect(calls).toBe(1);
    now = 3_000;
    await monitor.snapshot();
    expect(calls).toBe(2);
  });

  it('does not put error messages on the report', async () => {
    const monitor = new HealthMonitor({
      checks: [
        {
          name: 'postgres',
          check: async () => {
            throw new Error('connect ECONNREFUSED 10.1.2.3:5432');
          },
        },
      ],
      timeoutMs: 200,
    });
    const report = await monitor.snapshot();
    expect(report.status).toBe('degraded');
    expect(report.checks['postgres']?.status).toBe('down');
    expect(report.checks['postgres']).not.toHaveProperty('error');
    expect(JSON.stringify(report)).not.toContain('10.1.2.3');
  });
});
