/**
 * SESS-06: when Redis is down, each instance uses an in-process bucket at
 * half the normal limit / instance count. Normal-path Redis limiter is S11b-4.
 */
export class DegradedRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string): 'ok' | 'limited' {
    const now = this.now();
    const cutoff = now - this.windowMs;
    if (this.hits.size >= 4_096 && !this.hits.has(key)) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    const previous = (this.hits.get(key) ?? []).filter((at) => at >= cutoff);
    if (previous.length >= this.limit) {
      this.hits.set(key, previous);
      return 'limited';
    }
    previous.push(now);
    this.hits.set(key, previous);
    return 'ok';
  }
}

export function halfLimitPerInstance(normalLimit: number, instanceCount: number): number {
  return Math.max(1, Math.floor(normalLimit / instanceCount / 2));
}
