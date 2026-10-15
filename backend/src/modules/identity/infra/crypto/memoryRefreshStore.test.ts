import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REFRESH_GRACE_MS, SESSION_TTL } from '../../domain/sessionTtl.js';
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
    if (rotated.status === 'rejected') throw new Error('expected rotate');
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(store.peek(issued.hash)?.rotatedAt).toEqual(now);
    expect(store.peek(issued.hash)?.successor).toBe(rotated.hash);
    expect(store.peek(issued.hash)?.successor).not.toBe(rotated.refreshToken);
  });

  it('AUTH-RT-02: grace ≤20s returns a fresh rotation; reuse after grace revokes the family', async () => {
    const store = new MemoryRefreshTokenStore();
    let now = new Date('2026-10-15T00:00:00.000Z');
    const clock = () => now;
    const issued = await store.issue({ ...ids(), typ: 'staff' }, clock);
    const first = await store.rotate(issued.refreshToken, 'staff', clock);
    expect(first.status).toBe('rotated');

    now = new Date(now.getTime() + REFRESH_GRACE_MS - 1);
    const grace = await store.rotate(issued.refreshToken, 'staff', clock);
    expect(grace.status).toBe('grace');
    if (grace.status === 'rejected') throw new Error('expected grace');
    expect(store.sessions.get(issued.sid)?.revokedAt).toBeNull();

    now = new Date(now.getTime() + 2);
    const reuse = await store.rotate(issued.refreshToken, 'staff', clock);
    expect(reuse).toEqual({ status: 'rejected', reason: 'reuse' });
    expect(store.sessions.get(issued.sid)?.revokedAt).toEqual(now);
    if (first.status === 'rejected') throw new Error('expected first');
    const afterRevoke = await store.rotate(first.refreshToken, 'staff', clock);
    expect(afterRevoke).toEqual({ status: 'rejected', reason: 'family_revoked' });
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
    if (rotated.status === 'rejected') throw new Error('expected rotate');
    const row = store.peek(issued.hash);
    expect(row?.successor).toBe(hashRefreshToken(rotated.refreshToken));
    expect(row?.successor).not.toContain(rotated.refreshToken);
    expect([...store.tokens.keys()].every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(JSON.stringify([...store.tokens.values()])).not.toContain(issued.refreshToken);
    expect(JSON.stringify([...store.tokens.values()])).not.toContain(rotated.refreshToken);
  });
});
