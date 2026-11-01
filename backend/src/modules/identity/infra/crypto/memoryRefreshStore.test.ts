import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../../../platform/auth/jwt.js';
import { REFRESH_GRACE_MS, SESSION_TTL } from '../../domain/sessionTtl.js';
import {
  REFRESH_GRACE_AUDIT_ACTION,
  REFRESH_REUSE_AUDIT_ACTION,
  SESSIONS_REVOKED_EVENT,
} from '../../events.js';
import { hashRefreshToken } from './refreshHash.js';
import { MemoryRefreshTokenStore } from './memoryRefreshStore.js';

function ids() {
  return { accountId: randomUUID(), sid: randomUUID(), familyId: randomUUID() };
}

describe('MemoryRefreshTokenStore', () => {
  it('AUTH-RT-01: issues an opaque ≥256-bit token, stores only the hash, and rotates once', async () => {
    const store = new MemoryRefreshTokenStore();
    const now = new Date('2026-10-15T00:00:00.000Z');
    const issued = await store.issue({ ...ids(), typ: 'shopkeeper' }, () => now);
    expect(issued.refreshToken.length).toBeGreaterThanOrEqual(43);
    expect(store.plaintextTokens()).toEqual([]);
    expect(store.peek(issued.hash)?.successor).toBeNull();
    expect(store.peek(hashRefreshToken(issued.refreshToken))?.hash).toBe(issued.hash);

    const rotated = await store.rotate(issued.refreshToken, 'shopkeeper', () => now);
    expect(rotated.status).toBe('rotated');
    if (rotated.status !== 'rotated') throw new Error('expected rotate');
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(store.peek(issued.hash)?.rotatedAt).toEqual(now);
    expect(store.peek(issued.hash)?.successor).toBe(rotated.hash);
    expect(store.peek(issued.hash)?.successor).not.toBe(rotated.refreshToken);
  });

  it('AUTH-RT-02-G1: grace is honoured once within 20s while the successor is unused', async () => {
    const store = new MemoryRefreshTokenStore();
    let now = new Date('2026-10-15T00:00:00.000Z');
    const clock = () => now;
    const issued = await store.issue({ ...ids(), typ: 'staff' }, clock);
    const first = await store.rotate(issued.refreshToken, 'staff', clock);
    expect(first.status).toBe('rotated');
    if (first.status !== 'rotated') throw new Error('expected rotate');
    const tokensBeforeGrace = store.tokens.size;

    now = new Date(now.getTime() + REFRESH_GRACE_MS - 1);
    const grace = await store.rotate(issued.refreshToken, 'staff', clock);
    expect(grace.status).toBe('grace');
    if (grace.status !== 'grace') throw new Error('expected grace');
    expect(grace).not.toHaveProperty('refreshToken');
    expect(store.tokens.size).toBe(tokensBeforeGrace);
    expect(store.peek(issued.hash)?.graceUsedAt).toEqual(now);
    expect(store.sessions.get(issued.sid)?.revokedAt).toBeNull();

    const second = await store.rotate(issued.refreshToken, 'staff', clock);
    expect(second).toEqual({ status: 'rejected', reason: 'reuse' });
    expect(store.sessions.get(issued.sid)?.revokedAt).toEqual(now);
    const afterRevoke = await store.rotate(first.refreshToken, 'staff', clock);
    expect(afterRevoke).toEqual({ status: 'rejected', reason: 'family_revoked' });
  });

  it('AUTH-RT-02-G2: grace access keeps the same sid/family and the normal access TTL', async () => {
    const store = new MemoryRefreshTokenStore();
    const now = new Date('2026-10-15T00:00:00.000Z');
    const input = { ...ids(), typ: 'shopkeeper' as const };
    const issued = await store.issue(input, () => now);
    await store.rotate(issued.refreshToken, 'shopkeeper', () => now);
    const grace = await store.rotate(issued.refreshToken, 'shopkeeper', () => now);
    expect(grace).toMatchObject({
      status: 'grace',
      sid: issued.sid,
      familyId: issued.familyId,
      typ: 'shopkeeper',
      accountId: input.accountId,
    });
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
  });

  it('AUTH-RT-02-G3: grace replay and reuse revocation are audited; reuse emits sessions_revoked', async () => {
    const store = new MemoryRefreshTokenStore();
    let now = new Date('2026-10-15T00:00:00.000Z');
    const issued = await store.issue({ ...ids(), typ: 'staff' }, () => now);
    await store.rotate(issued.refreshToken, 'staff', () => now);
    const grace = await store.rotate(issued.refreshToken, 'staff', () => now);
    expect(grace.status).toBe('grace');
    expect(REFRESH_GRACE_AUDIT_ACTION).toBe('refresh_grace_replay');
    expect(store.audits.map((row) => row.action)).toEqual([REFRESH_GRACE_AUDIT_ACTION]);
    expect(store.events).toEqual([]);

    now = new Date(now.getTime() + REFRESH_GRACE_MS + 1);
    const reuse = await store.rotate(issued.refreshToken, 'staff', () => now);
    expect(reuse).toEqual({ status: 'rejected', reason: 'reuse' });
    expect(store.audits.map((row) => row.action)).toEqual([
      REFRESH_GRACE_AUDIT_ACTION,
      REFRESH_REUSE_AUDIT_ACTION,
    ]);
    expect(store.events).toEqual([
      expect.objectContaining({
        type: SESSIONS_REVOKED_EVENT,
        aggregateType: 'session',
        aggregateId: issued.familyId,
        payload: expect.objectContaining({
          familyId: issued.familyId,
          sid: issued.sid,
          reason: 'refresh_reuse',
        }),
      }),
    ]);
    expect(JSON.stringify(store.audits)).not.toContain(issued.refreshToken);
  });

  it('AUTH-RT-02-G5: reuse after 20s, a second grace, or a used successor revokes the family', async () => {
    const afterWindow = new MemoryRefreshTokenStore();
    let now = new Date('2026-10-15T00:00:00.000Z');
    const issued = await afterWindow.issue({ ...ids(), typ: 'staff' }, () => now);
    await afterWindow.rotate(issued.refreshToken, 'staff', () => now);
    now = new Date(now.getTime() + REFRESH_GRACE_MS + 1);
    expect(await afterWindow.rotate(issued.refreshToken, 'staff', () => now)).toEqual({
      status: 'rejected',
      reason: 'reuse',
    });

    const usedSuccessor = new MemoryRefreshTokenStore();
    now = new Date('2026-10-15T00:00:00.000Z');
    const second = await usedSuccessor.issue({ ...ids(), typ: 'staff' }, () => now);
    const first = await usedSuccessor.rotate(second.refreshToken, 'staff', () => now);
    expect(first.status).toBe('rotated');
    if (first.status !== 'rotated') throw new Error('expected rotate');
    await usedSuccessor.rotate(first.refreshToken, 'staff', () => now);
    expect(await usedSuccessor.rotate(second.refreshToken, 'staff', () => now)).toEqual({
      status: 'rejected',
      reason: 'reuse',
    });
  });

  it('9-16 / 11-10: rotated wrong-group replay is typ_mismatch and does not revoke', async () => {
    const store = new MemoryRefreshTokenStore();
    const now = new Date('2026-10-15T00:00:00.000Z');
    const issued = await store.issue({ ...ids(), typ: 'driver' }, () => now);
    await store.rotate(issued.refreshToken, 'driver', () => now);
    expect(await store.rotate(issued.refreshToken, 'staff', () => now)).toEqual({
      status: 'rejected',
      reason: 'typ_mismatch',
    });
    expect(store.sessions.get(issued.sid)?.revokedAt).toBeNull();
  });

  it('AUTH-RT-03: applies shopkeeper 30d/90d, staff 7d+12h idle, driver 10h absolute', async () => {
    const store = new MemoryRefreshTokenStore();
    const created = new Date('2026-10-15T00:00:00.000Z');
    const shop = await store.issue({ ...ids(), typ: 'shopkeeper' }, () => created);
    expect(shop.absoluteExpiresAt.getTime() - created.getTime()).toBe(
      SESSION_TTL.shopkeeper.absoluteMs,
    );
    expect(shop.refreshExpiresAt.getTime() - created.getTime()).toBe(SESSION_TTL.shopkeeper.idleMs);

    const staff = await store.issue({ ...ids(), typ: 'staff' }, () => created);
    expect(staff.absoluteExpiresAt.getTime() - created.getTime()).toBe(
      SESSION_TTL.staff.absoluteMs,
    );
    expect(staff.refreshExpiresAt.getTime() - created.getTime()).toBe(SESSION_TTL.staff.idleMs);

    const driver = await store.issue({ ...ids(), typ: 'driver' }, () => created);
    expect(driver.absoluteExpiresAt.getTime() - created.getTime()).toBe(
      SESSION_TTL.driver.absoluteMs,
    );
    expect(driver.refreshExpiresAt).toEqual(driver.absoluteExpiresAt);

    const idleAt = new Date(created.getTime() + SESSION_TTL.staff.idleMs + 1);
    expect(await store.rotate(staff.refreshToken, 'staff', () => idleAt)).toEqual({
      status: 'rejected',
      reason: 'idle_expired',
    });
    const driverPast = new Date(created.getTime() + SESSION_TTL.driver.absoluteMs + 1);
    expect(await store.rotate(driver.refreshToken, 'driver', () => driverPast)).toEqual({
      status: 'rejected',
      reason: 'absolute_expired',
    });
  });

  it('AUTH-RT-04: refresh tokens are bound to the route-group typ', async () => {
    const store = new MemoryRefreshTokenStore();
    const issued = await store.issue({ ...ids(), typ: 'driver' }, () => new Date());
    expect(await store.rotate(issued.refreshToken, 'staff')).toEqual({
      status: 'rejected',
      reason: 'typ_mismatch',
    });
    expect(await store.rotate(issued.refreshToken, 'shopkeeper')).toEqual({
      status: 'rejected',
      reason: 'typ_mismatch',
    });
    const ok = await store.rotate(issued.refreshToken, 'driver');
    expect(ok.status).toBe('rotated');
  });

  it('AUTH-RT-05: successor and primary key are hashes; plaintext is never stored', async () => {
    const store = new MemoryRefreshTokenStore();
    const issued = await store.issue({ ...ids(), typ: 'shopkeeper' }, () => new Date());
    const rotated = await store.rotate(issued.refreshToken, 'shopkeeper');
    if (rotated.status !== 'rotated') throw new Error('expected rotate');
    const row = store.peek(issued.hash);
    expect(row?.successor).toBe(hashRefreshToken(rotated.refreshToken));
    expect(row?.successor).not.toContain(rotated.refreshToken);
    expect([...store.tokens.keys()].every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(JSON.stringify([...store.tokens.values()])).not.toContain(issued.refreshToken);
    expect(JSON.stringify([...store.tokens.values()])).not.toContain(rotated.refreshToken);
  });
});
