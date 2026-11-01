import type { Redis } from 'ioredis';
import type { SubjectType } from './jwt.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './jwt.js';

export const REDIS_SID_BUDGET_MS = 50;
export const BREAKER_ERROR_THRESHOLD = 5;
export const BREAKER_WINDOW_MS = 10_000;
export const BREAKER_OPEN_MS = 30_000;
export const PG_FALLBACK_CACHE_MS = 2_000;
export const PG_FALLBACK_POOL_MAX = 5;
export const DENY_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS;

export type SessionAccountStatus = 'active' | 'inactive';
export type StaffRole = 'super_admin' | 'distributor_admin';

export interface SessionSnapshot {
  sid: string;
  accountId: string;
  typ: SubjectType;
  familyId: string;
  sessionVersion: number;
  accountStatus: SessionAccountStatus;
  revokedAt: string | null;
  distributorId: string | null;
  staffRole: StaffRole | null;
  permissions: readonly string[];
  mustChangePassword: boolean;
}

export type SessionDecision =
  | { status: 'active'; row: SessionSnapshot }
  | { status: 'revoked'; reason: string }
  | { status: 'inactive' }
  | { status: 'unknown' }
  | { status: 'unavailable' };

export interface SessionReader {
  lookup(sid: string): Promise<SessionSnapshot | null>;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface SessionAuthority {
  readonly hasPgFallback: true;
  check(sid: string, claimedVersion?: number): Promise<SessionDecision>;
  rememberLive(row: SessionSnapshot): Promise<void>;
  deny(sids: readonly string[]): Promise<void>;
  invalidateLive(sids: readonly string[]): Promise<void>;
  breakerState(): CircuitState;
  pgFallbackTotal(): number;
  pgLookupsFor(sid: string): number;
}

export interface CircuitBreakerClock {
  now(): number;
}

class CircuitBreaker {
  private errors: number[] = [];
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly clock: CircuitBreakerClock,
    private readonly threshold = BREAKER_ERROR_THRESHOLD,
    private readonly windowMs = BREAKER_WINDOW_MS,
    private readonly openMs = BREAKER_OPEN_MS,
  ) {}

  state(): CircuitState {
    this.expire();
    if (this.openedAt === null) return 'closed';
    if (this.clock.now() - this.openedAt >= this.openMs) return 'half_open';
    return 'open';
  }

  allowProbe(): boolean {
    if (this.state() !== 'half_open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.errors = [];
    this.openedAt = null;
    this.probing = false;
  }

  recordFailure(): void {
    const now = this.clock.now();
    this.errors.push(now);
    this.expire();
    this.probing = false;
    if (this.errors.length >= this.threshold) {
      this.openedAt = now;
      this.errors = [];
    } else if (this.openedAt !== null) {
      this.openedAt = now;
    }
  }

  private expire(): void {
    const cutoff = this.clock.now() - this.windowMs;
    this.errors = this.errors.filter((at) => at >= cutoff);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class RedisPgSessionAuthority implements SessionAuthority {
  readonly hasPgFallback = true as const;
  private readonly breaker: CircuitBreaker;
  private readonly liveLru = new Map<string, { at: number; row: SessionSnapshot }>();
  private readonly lookupCounts = new Map<string, number>();
  private readonly inflightPg = new Map<string, Promise<SessionSnapshot | null>>();
  private fallbacks = 0;
  private readonly clock: CircuitBreakerClock;

  constructor(
    private readonly redis: Redis,
    private readonly reader: SessionReader,
    options: { clock?: CircuitBreakerClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.breaker = new CircuitBreaker(this.clock);
  }

  breakerState(): CircuitState {
    return this.breaker.state();
  }

  pgFallbackTotal(): number {
    return this.fallbacks;
  }

  pgLookupsFor(sid: string): number {
    return this.lookupCounts.get(sid) ?? 0;
  }

  async rememberLive(row: SessionSnapshot): Promise<void> {
    await this.redis.set(liveKey(row.sid), JSON.stringify(row), 'EX', DENY_TTL_SECONDS);
  }

  async deny(sids: readonly string[]): Promise<void> {
    if (sids.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const sid of sids) {
      pipeline.set(denyKey(sid), '1', 'EX', DENY_TTL_SECONDS);
      pipeline.del(liveKey(sid));
      this.liveLru.delete(sid);
    }
    await pipeline.exec();
  }

  async invalidateLive(sids: readonly string[]): Promise<void> {
    if (sids.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const sid of sids) {
      pipeline.del(liveKey(sid));
      this.liveLru.delete(sid);
    }
    await pipeline.exec();
  }

  async check(sid: string, claimedVersion?: number): Promise<SessionDecision> {
    const fromRedis = await this.checkRedis(sid);
    if (fromRedis !== undefined) return this.decide(fromRedis, claimedVersion);

    const cached = this.liveLru.get(sid);
    const now = this.clock.now();
    if (cached && now - cached.at < PG_FALLBACK_CACHE_MS) {
      return this.decide({ status: 'active', row: cached.row }, claimedVersion);
    }

    try {
      const row = await this.lookupPg(sid);
      if (row === null) return { status: 'unknown' };
      if (row.revokedAt !== null) {
        return { status: 'revoked', reason: 'revoked' };
      }
      if (row.accountStatus === 'inactive') {
        return { status: 'inactive' };
      }
      this.liveLru.set(sid, { at: now, row });
      return this.decide({ status: 'active', row }, claimedVersion);
    } catch {
      return { status: 'unavailable' };
    }
  }

  private lookupPg(sid: string): Promise<SessionSnapshot | null> {
    const existing = this.inflightPg.get(sid);
    if (existing) return existing;
    this.fallbacks += 1;
    this.lookupCounts.set(sid, (this.lookupCounts.get(sid) ?? 0) + 1);
    const pending = this.reader.lookup(sid).finally(() => {
      this.inflightPg.delete(sid);
    });
    this.inflightPg.set(sid, pending);
    return pending;
  }

  private decide(
    hit:
      | { status: 'active'; row: SessionSnapshot }
      | { status: 'revoked'; reason: string }
      | { status: 'denied' },
    claimedVersion?: number,
  ): SessionDecision {
    if (hit.status === 'denied' || hit.status === 'revoked') {
      return { status: 'revoked', reason: hit.status === 'denied' ? 'deny_set' : hit.reason };
    }
    if (hit.row.revokedAt !== null) return { status: 'revoked', reason: 'revoked' };
    if (hit.row.accountStatus === 'inactive') return { status: 'inactive' };
    if (claimedVersion !== undefined && claimedVersion !== hit.row.sessionVersion) {
      return { status: 'revoked', reason: 'session_version' };
    }
    return { status: 'active', row: hit.row };
  }

  private async checkRedis(
    sid: string,
  ): Promise<
    | { status: 'active'; row: SessionSnapshot }
    | { status: 'denied' }
    | { status: 'revoked'; reason: string }
    | undefined
  > {
    const state = this.breaker.state();
    if (state === 'open') return undefined;
    if (state === 'half_open' && !this.breaker.allowProbe()) return undefined;

    try {
      const [denied, raw] = await withTimeout(
        Promise.all([this.redis.get(denyKey(sid)), this.redis.get(liveKey(sid))]),
        REDIS_SID_BUDGET_MS,
      );
      this.breaker.recordSuccess();
      if (denied !== null) return { status: 'denied' };
      if (raw === null) return undefined;
      const row = JSON.parse(raw) as SessionSnapshot;
      return { status: 'active', row };
    } catch {
      this.breaker.recordFailure();
      return undefined;
    }
  }
}

export function denyKey(sid: string): string {
  return `sess:deny:${sid}`;
}

export function liveKey(sid: string): string {
  return `sess:live:${sid}`;
}
