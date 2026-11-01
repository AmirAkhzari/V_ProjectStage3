import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { SubjectType } from './jwt.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './jwt.js';

export const REDIS_SID_BUDGET_MS = 50;
export const REDIS_DENY_TIMEOUT_MS = 200;
export const REDIS_PING_TIMEOUT_MS = 2_000;
export const BREAKER_ERROR_THRESHOLD = 5;
export const BREAKER_WINDOW_MS = 10_000;
export const BREAKER_OPEN_MS = 30_000;
export const PG_FALLBACK_CACHE_MS = 2_000;
export const PG_FALLBACK_POOL_MAX = 5;
export const PG_FALLBACK_CONNECT_TIMEOUT_MS = 2_000;
export const PG_FALLBACK_STATEMENT_TIMEOUT_MS = 2_000;
export const PG_LOOKUP_TIMEOUT_MS = 2_000;
export const DENY_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS;
/** Live Redis cache must expire within the AUTH-RV-01 5s bound (11-1). */
export const LIVE_TTL_SECONDS = 5;
export const DENY_ATTEMPTS = 3;
export const IN_PROCESS_MAP_MAX = 4_096;

export function fallbackPoolOptions(connectionString: string): {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  query_timeout: number;
} {
  return {
    connectionString,
    max: PG_FALLBACK_POOL_MAX,
    connectionTimeoutMillis: PG_FALLBACK_CONNECT_TIMEOUT_MS,
    statement_timeout: PG_FALLBACK_STATEMENT_TIMEOUT_MS,
    query_timeout: PG_FALLBACK_STATEMENT_TIMEOUT_MS,
  };
}

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

const sessionSnapshotSchema = z.object({
  sid: z.string().min(1),
  accountId: z.string().min(1),
  typ: z.enum(['shopkeeper', 'staff', 'driver']),
  familyId: z.string().min(1),
  sessionVersion: z.number().int().nonnegative(),
  accountStatus: z.enum(['active', 'inactive']),
  revokedAt: z.string().nullable(),
  distributorId: z.string().nullable(),
  staffRole: z.enum(['super_admin', 'distributor_admin']).nullable(),
  permissions: z.array(z.string()),
  mustChangePassword: z.boolean(),
});

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

export interface SessionCheckOptions {
  /** Bypass Redis live + in-process fallback cache and read PG (A-11-2). */
  fresh?: boolean;
}

export interface SessionAuthority {
  readonly hasPgFallback: true;
  check(
    sid: string,
    claimedVersion?: number,
    options?: SessionCheckOptions,
  ): Promise<SessionDecision>;
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

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max = IN_PROCESS_MAP_MAX): void {
  if (map.size >= max && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export class RedisPgSessionAuthority implements SessionAuthority {
  readonly hasPgFallback = true as const;
  private readonly breaker: CircuitBreaker;
  private readonly liveLru = new Map<string, { at: number; row: SessionSnapshot }>();
  private readonly lookupCounts = new Map<string, number>();
  private readonly inflightPg = new Map<string, Promise<SessionSnapshot | null>>();
  private readonly forcePg = new Set<string>();
  private readonly liveWriteEpoch = new Map<string, number>();
  private failureEpoch = 0;
  private pendingEpochBump = false;
  private fallbacks = 0;
  private readonly clock: CircuitBreakerClock;
  private readonly lookupTimeoutMs: number;
  private readonly denyAttempts: number;

  constructor(
    private readonly redis: Redis,
    private readonly reader: SessionReader,
    options: {
      clock?: CircuitBreakerClock;
      lookupTimeoutMs?: number;
      denyAttempts?: number;
    } = {},
  ) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.breaker = new CircuitBreaker(this.clock);
    this.lookupTimeoutMs = options.lookupTimeoutMs ?? PG_LOOKUP_TIMEOUT_MS;
    this.denyAttempts = options.denyAttempts ?? DENY_ATTEMPTS;
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
    const epoch = await this.ensureFailEpoch();
    await withTimeout(
      this.redis.set(
        liveKey(row.sid),
        JSON.stringify({ e: epoch, r: row }),
        'EX',
        LIVE_TTL_SECONDS,
      ),
      REDIS_DENY_TIMEOUT_MS,
    );
    setBounded(this.liveWriteEpoch, row.sid, epoch);
  }

  async deny(sids: readonly string[]): Promise<void> {
    if (sids.length === 0) return;
    this.dropLocalLive(sids);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.denyAttempts; attempt += 1) {
      try {
        await this.writeDeny(sids);
        for (const sid of sids) this.forcePg.delete(sid);
        return;
      } catch (error) {
        lastError = error;
        this.markRedisFailure();
      }
    }
    for (const sid of sids) this.forcePg.add(sid);
    throw lastError instanceof Error ? lastError : new Error('deny pipeline failed');
  }

  async invalidateLive(sids: readonly string[]): Promise<void> {
    if (sids.length === 0) return;
    this.dropLocalLive(sids);
    const pipeline = this.redis.pipeline();
    for (const sid of sids) pipeline.del(liveKey(sid));
    const results = await withTimeout(pipeline.exec(), REDIS_DENY_TIMEOUT_MS);
    assertPipelineOk(results);
  }

  async check(
    sid: string,
    claimedVersion?: number,
    options?: SessionCheckOptions,
  ): Promise<SessionDecision> {
    const fresh = options?.fresh === true;
    const fromRedis = fresh || this.forcePg.has(sid) ? undefined : await this.checkRedis(sid);
    if (fromRedis !== undefined) return this.decide(fromRedis, claimedVersion);

    const cached = this.liveLru.get(sid);
    const now = this.clock.now();
    if (!fresh && !this.forcePg.has(sid) && cached && now - cached.at < PG_FALLBACK_CACHE_MS) {
      return this.decide({ status: 'active', row: cached.row }, claimedVersion);
    }

    try {
      const row = await this.lookupPg(sid);
      if (row === null) return { status: 'unknown' };
      if (row.revokedAt !== null) {
        return { status: 'revoked', reason: 'revoked' };
      }
      if (row.accountStatus !== 'active') {
        return { status: 'inactive' };
      }
      this.forcePg.delete(sid);
      setBounded(this.liveLru, sid, { at: now, row });
      return this.decide({ status: 'active', row }, claimedVersion);
    } catch {
      return { status: 'unavailable' };
    }
  }

  private lookupPg(sid: string): Promise<SessionSnapshot | null> {
    const existing = this.inflightPg.get(sid);
    if (existing) return existing;
    this.fallbacks += 1;
    setBounded(this.lookupCounts, sid, (this.lookupCounts.get(sid) ?? 0) + 1);
    const pending = withTimeout(this.reader.lookup(sid), this.lookupTimeoutMs).finally(() => {
      this.inflightPg.delete(sid);
    });
    setBounded(this.inflightPg, sid, pending);
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
    if (hit.row.accountStatus !== 'active') return { status: 'inactive' };
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
      const epoch = await this.ensureFailEpoch();
      const [denied, raw] = await withTimeout(
        Promise.all([this.redis.get(denyKey(sid)), this.redis.get(liveKey(sid))]),
        REDIS_SID_BUDGET_MS,
      );
      this.breaker.recordSuccess();
      if (denied !== null) return { status: 'denied' };
      if (raw === null) return undefined;
      const parsed = parseLiveRecord(raw);
      if (parsed === null) return undefined;
      const written = this.liveWriteEpoch.get(sid);
      if (written !== undefined && written < this.failureEpoch) return undefined;
      if (parsed.epoch < epoch) return undefined;
      return { status: 'active', row: parsed.row };
    } catch {
      this.breaker.recordFailure();
      this.markRedisFailure();
      return undefined;
    }
  }

  private async writeDeny(sids: readonly string[]): Promise<void> {
    await this.ensureFailEpoch();
    const pipeline = this.redis.pipeline();
    for (const sid of sids) {
      pipeline.set(denyKey(sid), '1', 'EX', DENY_TTL_SECONDS);
      pipeline.del(liveKey(sid));
    }
    const results = await withTimeout(pipeline.exec(), REDIS_DENY_TIMEOUT_MS);
    assertPipelineOk(results);
  }

  private markRedisFailure(): void {
    this.failureEpoch += 1;
    this.pendingEpochBump = true;
  }

  private async ensureFailEpoch(): Promise<number> {
    if (!this.pendingEpochBump) return this.failureEpoch;
    try {
      const next = await withTimeout(this.redis.incr(failEpochKey()), REDIS_DENY_TIMEOUT_MS);
      this.failureEpoch = Math.max(this.failureEpoch, Number(next));
      this.pendingEpochBump = false;
      return this.failureEpoch;
    } catch {
      return this.failureEpoch;
    }
  }

  private dropLocalLive(sids: readonly string[]): void {
    for (const sid of sids) this.liveLru.delete(sid);
  }
}

export function parseLiveSnapshot(raw: string): SessionSnapshot | null {
  return parseLiveRecord(raw)?.row ?? null;
}

function parseLiveRecord(raw: string): { epoch: number; row: SessionSnapshot } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && 'e' in parsed && 'r' in parsed) {
      const envelope = parsed as { e: unknown; r: unknown };
      const row = sessionSnapshotSchema.safeParse(envelope.r);
      return row.success && typeof envelope.e === 'number'
        ? { epoch: envelope.e, row: row.data }
        : null;
    }
    const row = sessionSnapshotSchema.safeParse(parsed);
    return row.success ? { epoch: 0, row: row.data } : null;
  } catch {
    return null;
  }
}

function assertPipelineOk(results: [Error | null, unknown][] | null): void {
  if (results === null) throw new Error('redis pipeline returned null');
  for (const [error] of results) {
    if (error) throw error;
  }
}

/** Fail-closed default: never trust a signature alone (11-2). */
export const failClosedSessionAuthority: SessionAuthority = {
  hasPgFallback: true,
  check: () => Promise.resolve({ status: 'unavailable' }),
  rememberLive: () => Promise.resolve(),
  deny: () => Promise.resolve(),
  invalidateLive: () => Promise.resolve(),
  breakerState: () => 'open',
  pgFallbackTotal: () => 0,
  pgLookupsFor: () => 0,
};

export function allowAllSessionAuthority(
  typ: SubjectType = 'shopkeeper',
  accountId = 'user-1',
): SessionAuthority {
  return {
    hasPgFallback: true,
    check: (sid, claimedVersion) =>
      Promise.resolve({
        status: 'active',
        row: {
          sid,
          accountId,
          typ,
          familyId: 'family-1',
          sessionVersion: claimedVersion ?? 0,
          accountStatus: 'active',
          revokedAt: null,
          distributorId: null,
          staffRole: typ === 'staff' ? 'distributor_admin' : null,
          permissions: [],
          mustChangePassword: false,
        },
      }),
    rememberLive: () => Promise.resolve(),
    deny: () => Promise.resolve(),
    invalidateLive: () => Promise.resolve(),
    breakerState: () => 'closed',
    pgFallbackTotal: () => 0,
    pgLookupsFor: () => 0,
  };
}

export function denyKey(sid: string): string {
  return `sess:deny:${sid}`;
}

export function liveKey(sid: string): string {
  return `sess:live:${sid}`;
}

export function failEpochKey(): string {
  return 'sess:fail_epoch';
}
