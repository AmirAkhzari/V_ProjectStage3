import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { AppError } from '../http/errors.js';
import { assertRedisForAuthIssuance } from './failClosed.js';
import {
  LIVE_TTL_SECONDS,
  parseLiveSnapshot,
  RedisPgSessionAuthority,
  liveKey,
  type SessionSnapshot,
} from './sessionAuthority.js';

const row = (sid: string): SessionSnapshot => ({
  sid,
  accountId: 'acc-1',
  typ: 'driver',
  familyId: 'fam-1',
  sessionVersion: 1,
  accountStatus: 'active',
  revokedAt: null,
  distributorId: 'dist-1',
  staffRole: null,
  permissions: [],
  mustChangePassword: false,
});

function fakeRedis(overrides: {
  get?: (key: string) => Promise<string | null>;
  set?: (...args: unknown[]) => Promise<string>;
  incr?: (key: string) => Promise<number>;
  exec?: () => Promise<[Error | null, unknown][] | null>;
  hangExec?: boolean;
  hangPing?: boolean;
}): Redis {
  const client = {
    status: 'ready',
    get: overrides.get ?? (async () => null),
    set: overrides.set ?? (async () => 'OK'),
    incr: overrides.incr ?? (async () => 0),
    connect: async () => undefined,
    ping: overrides.hangPing ? () => new Promise<string>(() => {}) : async () => 'PONG',
    pipeline() {
      return {
        set() {
          return this;
        },
        del() {
          return this;
        },
        exec: overrides.hangExec
          ? () => new Promise<[Error | null, unknown][] | null>(() => {})
          : (overrides.exec ?? (async () => [[null, 'OK']])),
      };
    },
  };
  return client as unknown as Redis;
}

describe('session authority Architect 11-1 / 11-4 / 11-11', () => {
  it('11-11: invalid live JSON is a miss, not a live hit', async () => {
    const sid = 'sid-bad';
    const authority = new RedisPgSessionAuthority(
      fakeRedis({
        get: async (key) => (key === liveKey(sid) ? '{"nope":true}' : null),
      }),
      { lookup: async () => row(sid) },
    );
    expect(parseLiveSnapshot('{"nope":true}')).toBeNull();
    const decision = await authority.check(sid, 1);
    expect(decision.status).toBe('active');
    expect(authority.pgLookupsFor(sid)).toBe(1);
  });

  it('11-1: deny pipeline per-command errors retry then force the PG path', async () => {
    const sid = 'sid-deny';
    let attempts = 0;
    const authority = new RedisPgSessionAuthority(
      fakeRedis({
        get: async (key) => (key === liveKey(sid) ? JSON.stringify(row(sid)) : null),
        exec: async () => {
          attempts += 1;
          return [[new Error('set failed'), null]];
        },
      }),
      {
        lookup: async () => ({ ...row(sid), revokedAt: new Date().toISOString() }),
      },
      { denyAttempts: 2 },
    );
    await expect(authority.deny([sid])).rejects.toThrow(/set failed/);
    expect(attempts).toBe(2);
    const decision = await authority.check(sid, 1);
    expect(decision.status).toBe('revoked');
    expect(authority.pgLookupsFor(sid)).toBe(1);
  });

  it('11-4: a hung PG lookup maps to unavailable', async () => {
    const authority = new RedisPgSessionAuthority(
      fakeRedis({}),
      { lookup: () => new Promise(() => {}) },
      { lookupTimeoutMs: 30 },
    );
    await expect(authority.check('sid-hang')).resolves.toEqual({ status: 'unavailable' });
  });

  it('11-4: a hung Redis ping fail-closes issuance', async () => {
    await expect(assertRedisForAuthIssuance(fakeRedis({ hangPing: true }))).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('live TTL is at most 5 seconds', () => {
    expect(LIVE_TTL_SECONDS).toBeLessThanOrEqual(5);
  });

  it('A-11-1: live rows written before the last Redis failure are misses', async () => {
    const sid = 'sid-epoch';
    let failGets = 0;
    const authority = new RedisPgSessionAuthority(
      fakeRedis({
        get: async (key) => {
          if (key !== liveKey(sid)) return null;
          failGets += 1;
          if (failGets === 1) throw new Error('redis down');
          return JSON.stringify({ e: 0, r: row(sid) });
        },
        incr: async () => 1,
      }),
      { lookup: async () => ({ ...row(sid), revokedAt: new Date().toISOString() }) },
    );
    await authority.check(sid, 1);
    const afterRestore = await authority.check(sid, 1);
    expect(afterRestore.status).toBe('revoked');
    expect(authority.pgLookupsFor(sid)).toBeGreaterThan(0);
  });

  it('A-11-2: fresh mode always hits PG and ignores live cache', async () => {
    const sid = 'sid-fresh';
    const authority = new RedisPgSessionAuthority(
      fakeRedis({
        get: async (key) => (key === liveKey(sid) ? JSON.stringify({ e: 0, r: row(sid) }) : null),
      }),
      { lookup: async () => ({ ...row(sid), revokedAt: new Date().toISOString() }) },
    );
    const cached = await authority.check(sid, 1);
    expect(cached.status).toBe('active');
    const fresh = await authority.check(sid, 1, { fresh: true });
    expect(fresh.status).toBe('revoked');
    expect(authority.pgLookupsFor(sid)).toBe(1);
  });

  it('A-11-8: half-open allows a single probe; success closes, failure re-opens', async () => {
    let now = 1_000;
    let gets = 0;
    let redisDown = true;
    const authority = new RedisPgSessionAuthority(
      fakeRedis({
        get: async () => {
          gets += 1;
          if (redisDown) throw new Error('down');
          return null;
        },
      }),
      { lookup: async () => null },
      { clock: { now: () => now } },
    );
    for (let i = 0; i < 5; i += 1) {
      await authority.check(`sid-${i}`);
    }
    expect(authority.breakerState()).toBe('open');
    const getsWhileOpen = gets;
    await authority.check('sid-open');
    expect(gets).toBe(getsWhileOpen);
    now += 30_001;
    expect(authority.breakerState()).toBe('half_open');
    redisDown = false;
    const first = authority.check('sid-probe-a');
    const second = authority.check('sid-probe-b');
    await Promise.all([first, second]);
    expect(gets).toBe(getsWhileOpen + 2);
    expect(authority.breakerState()).toBe('closed');

    redisDown = true;
    for (let i = 0; i < 5; i += 1) {
      await authority.check(`sid-reopen-${i}`);
    }
    expect(authority.breakerState()).toBe('open');
    now += 30_001;
    const beforeFailProbe = gets;
    await authority.check('sid-fail-probe');
    expect(gets).toBeGreaterThan(beforeFailProbe);
    expect(authority.breakerState()).toBe('open');
  });

  it('N12-5: breaker opens on 5 errors in a 10s window, not 5 consecutive', async () => {
    const now = 1_000;
    let fail = true;
    const authority = new RedisPgSessionAuthority(
      fakeRedis({
        get: async () => {
          if (fail) throw new Error('down');
          return null;
        },
      }),
      { lookup: async () => null },
      { clock: { now: () => now } },
    );
    await authority.check('a');
    await authority.check('b');
    await authority.check('c');
    expect(authority.breakerState()).toBe('closed');
    fail = false;
    await authority.check('ok');
    expect(authority.breakerState()).toBe('closed');
    fail = true;
    await authority.check('d');
    await authority.check('e');
    expect(authority.breakerState()).toBe('open');
  });

  it('N12-5: a hung deny pipeline times out', async () => {
    const authority = new RedisPgSessionAuthority(
      fakeRedis({ hangExec: true }),
      { lookup: async () => null },
      { denyAttempts: 1, denyTimeoutMs: 30 },
    );
    await expect(authority.deny(['sid-timeout'])).rejects.toThrow(/timed out after 30ms/);
  });
});
