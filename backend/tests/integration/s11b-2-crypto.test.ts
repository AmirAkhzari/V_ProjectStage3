import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import {
  BREACHED_LIST_VERSION,
  loadBreachedPasswordList,
  logBreachedListBoot,
} from '../../src/modules/identity/infra/crypto/breachedPasswords.js';
import { REFRESH_GRACE_MS } from '../../src/modules/identity/domain/sessionTtl.js';
import { hashRefreshToken } from '../../src/modules/identity/infra/crypto/refreshHash.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import {
  REFRESH_GRACE_AUDIT_ACTION,
  REFRESH_REUSE_AUDIT_ACTION,
  SESSIONS_REVOKED_EVENT,
} from '../../src/modules/identity/events.js';
import {
  attachPgTeardownGuard,
  startPostgresWithRoles,
  type StartedPostgresRoles,
} from '../helpers/containers.js';

async function seedShopkeeper(pool: pg.Pool): Promise<string> {
  const accountId = randomUUID();
  await pool.query(
    `INSERT INTO identity.accounts
       (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
     VALUES ($1, 'shopkeeper', $2, NULL, 'active', 0, false, now())`,
    [accountId, `+9891${accountId.replace(/-/g, '').slice(0, 8)}`],
  );
  return accountId;
}

async function familyRefreshTokenCount(pool: pg.Pool, familyId: string): Promise<number> {
  const found = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM identity.refresh_tokens WHERE family_id = $1`,
    [familyId],
  );
  return Number(found.rows[0]?.c ?? '0');
}

async function familyRevokeReasons(pool: pg.Pool, familyId: string): Promise<Array<string | null>> {
  const found = await pool.query<{ revoke_reason: string | null }>(
    `SELECT revoke_reason FROM identity.sessions WHERE family_id = $1`,
    [familyId],
  );
  return found.rows.map((row) => row.revoke_reason);
}

function expectFamilyRevokedForReuse(reasons: Array<string | null>): void {
  expect(reasons.length).toBeGreaterThan(0);
  expect(reasons.every((reason) => reason === 'refresh_reuse')).toBe(true);
}

describe('S11b-2 crypto integration', () => {
  let deps: StartedPostgresRoles;
  let identityPool: pg.Pool;
  let ownerPool: pg.Pool;

  beforeAll(async () => {
    deps = await startPostgresWithRoles();
    identityPool = new pg.Pool({ connectionString: deps.identityUrl, max: 16 });
    ownerPool = new pg.Pool({ connectionString: deps.ownerUrl });
    attachPgTeardownGuard(identityPool);
    attachPgTeardownGuard(ownerPool);
  });

  afterAll(async () => {
    await identityPool.end();
    await ownerPool.end();
    await deps.postgres.stop();
  });

  it('AUTH-PW-02-OFF: loads the versioned artifact at boot and makes no outbound HTTP', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const info = vi.fn();
    const list = loadBreachedPasswordList();
    logBreachedListBoot({ info }, list);
    expect(list.version).toBe(BREACHED_LIST_VERSION);
    expect(list.has('qwerty')).toBe(true);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        breachedListVersion: BREACHED_LIST_VERSION,
        breachedListSize: list.size,
        breachedListSha256: list.sha256,
      }),
      'offline breached-password list loaded',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('AUTH-RT-05: persists only hashes in identity.refresh_tokens and rotates via UPDATE', async () => {
    const accountId = randomUUID();
    await identityPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'shopkeeper', $2, NULL, 'active', 0, false, now())`,
      [accountId, `+98912${accountId.replace(/-/g, '').slice(0, 7)}`],
    );
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    const stored = await identityPool.query<{ hash: string; successor: string | null }>(
      `SELECT hash, successor FROM identity.refresh_tokens WHERE sid = $1`,
      [issued.sid],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.hash).toBe(issued.hash);
    expect(JSON.stringify(stored.rows)).not.toContain(issued.refreshToken);

    const rotated = await store.rotate(issued.refreshToken, 'shopkeeper');
    expect(rotated.status).toBe('rotated');
    if (rotated.status !== 'rotated') throw new Error('expected rotate');
    const after = await identityPool.query<{
      hash: string;
      successor: string | null;
      rotated_at: Date | null;
    }>(
      `SELECT hash, successor, rotated_at FROM identity.refresh_tokens WHERE sid = $1 ORDER BY rotated_at NULLS LAST`,
      [issued.sid],
    );
    expect(after.rows).toHaveLength(2);
    const previous = after.rows.find((row) => row.hash === issued.hash);
    expect(previous?.successor).toBe(hashRefreshToken(rotated.refreshToken));
    expect(previous?.rotated_at).not.toBeNull();
    expect(JSON.stringify(after.rows)).not.toContain(issued.refreshToken);
    expect(JSON.stringify(after.rows)).not.toContain(rotated.refreshToken);
  });

  it('AUTH-RT-05 / AppSec 9-1: ten parallel refreshes mint exactly one successor', async () => {
    const accountId = randomUUID();
    await identityPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'shopkeeper', $2, NULL, 'active', 0, false, now())`,
      [accountId, `+98913${accountId.replace(/-/g, '').slice(0, 7)}`],
    );
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.rotate(issued.refreshToken, 'shopkeeper')),
    );
    expect(results.filter((row) => row.status === 'rotated')).toHaveLength(1);

    const tokens = await identityPool.query<{
      hash: string;
      successor: string | null;
      rotated_at: Date | null;
    }>(`SELECT hash, successor, rotated_at FROM identity.refresh_tokens WHERE sid = $1`, [
      issued.sid,
    ]);
    expect(tokens.rows).toHaveLength(2);
    const parent = tokens.rows.find((row) => row.hash === issued.hash);
    const successor = tokens.rows.find((row) => row.hash !== issued.hash);
    expect(parent?.successor).toBe(successor?.hash);
    expect(JSON.stringify(tokens.rows)).not.toContain(issued.refreshToken);
  });

  it('AUTH-RT-02-G3/G4: grace is audited under the rotate row lock; reuse writes audit+outbox', async () => {
    const accountId = randomUUID();
    await identityPool.query(
      `INSERT INTO identity.accounts
         (id, typ, phone, username_norm, status, session_version, must_change_password, created_at)
       VALUES ($1, 'shopkeeper', $2, NULL, 'active', 0, false, now())`,
      [accountId, `+98914${accountId.replace(/-/g, '').slice(0, 7)}`],
    );
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    const first = await store.rotate(issued.refreshToken, 'shopkeeper');
    expect(first.status).toBe('rotated');

    const locker = await identityPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(`SELECT hash FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`, [
        issued.hash,
      ]);
      const pending = store.rotate(issued.refreshToken, 'shopkeeper');
      const raced = await Promise.race([
        pending.then(() => 'done' as const),
        new Promise<'waiting'>((resolve) => {
          setTimeout(() => resolve('waiting'), 250);
        }),
      ]);
      expect(raced).toBe('waiting');
      await locker.query('COMMIT');
      const grace = await pending;
      expect(grace.status).toBe('grace');
      if (grace.status !== 'grace') throw new Error('expected grace');
      expect(grace.sid).toBe(issued.sid);
      expect(grace.familyId).toBe(issued.familyId);
      expect(grace).not.toHaveProperty('refreshToken');
    } finally {
      locker.release();
    }

    const audits = await ownerPool.query<{ action: string }>(
      `SELECT action FROM platform.audit_log WHERE entity_id = $1 ORDER BY at`,
      [issued.familyId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([REFRESH_GRACE_AUDIT_ACTION]);

    const reuse = await store.rotate(issued.refreshToken, 'shopkeeper');
    expect(reuse).toEqual({ status: 'rejected', reason: 'reuse' });
    const after = await ownerPool.query<{ action: string }>(
      `SELECT action FROM platform.audit_log WHERE entity_id = $1 ORDER BY at`,
      [issued.familyId],
    );
    expect(after.rows.map((row) => row.action)).toEqual([
      REFRESH_GRACE_AUDIT_ACTION,
      REFRESH_REUSE_AUDIT_ACTION,
    ]);
    const outbox = await ownerPool.query<{ event_type: string; payload: { familyId?: string } }>(
      `SELECT event_type, payload FROM platform.outbox_events WHERE aggregate_id = $1`,
      [issued.familyId],
    );
    expect(outbox.rows).toEqual([
      expect.objectContaining({
        event_type: SESSIONS_REVOKED_EVENT,
        payload: expect.objectContaining({ familyId: issued.familyId, reason: 'refresh_reuse' }),
      }),
    ]);
    expectFamilyRevokedForReuse(await familyRevokeReasons(identityPool, issued.familyId));
  });

  it('AUTH-RT-02-G5: ten parallel replays give exactly 1 AT, 0 RT, and revoke the family', async () => {
    const accountId = await seedShopkeeper(identityPool);
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    const first = await store.rotate(issued.refreshToken, 'shopkeeper');
    expect(first.status).toBe('rotated');
    expect(await familyRefreshTokenCount(identityPool, issued.familyId)).toBe(2);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.rotate(issued.refreshToken, 'shopkeeper')),
    );
    const graces = results.filter((row) => row.status === 'grace');
    const minted = results.filter((row) => row.status === 'rotated');
    const reuses = results.filter((row) => row.status === 'rejected' && row.reason === 'reuse');
    expect(graces).toHaveLength(1);
    expect(minted).toHaveLength(0);
    expect(reuses.length).toBeGreaterThanOrEqual(1);
    expect(graces[0]).not.toHaveProperty('refreshToken');

    expect(await familyRefreshTokenCount(identityPool, issued.familyId)).toBe(2);
    const session = await identityPool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.sessions WHERE sid = $1`,
      [issued.sid],
    );
    expect(session.rows[0]?.revoked_at).not.toBeNull();
    expectFamilyRevokedForReuse(await familyRevokeReasons(identityPool, issued.familyId));
    const audits = await ownerPool.query<{ action: string }>(
      `SELECT action FROM platform.audit_log WHERE entity_id = $1 ORDER BY at`,
      [issued.familyId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([REFRESH_GRACE_AUDIT_ACTION, REFRESH_REUSE_AUDIT_ACTION]),
    );
    expect(audits.rows.filter((row) => row.action === REFRESH_GRACE_AUDIT_ACTION)).toHaveLength(1);
    const outbox = await ownerPool.query<{ event_type: string }>(
      `SELECT event_type FROM platform.outbox_events WHERE aggregate_id = $1`,
      [issued.familyId],
    );
    expect(outbox.rows.some((row) => row.event_type === SESSIONS_REVOKED_EVENT)).toBe(true);
  });

  it('AUTH-RT-02: lock_timeout is retryable and changes no state', async () => {
    const accountId = await seedShopkeeper(identityPool);
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    await store.rotate(issued.refreshToken, 'shopkeeper');
    const locker = await identityPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(`SELECT hash FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`, [
        issued.hash,
      ]);
      const result = await store.rotate(issued.refreshToken, 'shopkeeper');
      expect(result).toEqual({ status: 'rejected', reason: 'lock_timeout' });
      await locker.query('COMMIT');
    } finally {
      locker.release();
    }
    const tokens = await identityPool.query<{ grace_used_at: Date | null }>(
      `SELECT grace_used_at FROM identity.refresh_tokens WHERE hash = $1`,
      [issued.hash],
    );
    expect(tokens.rows[0]?.grace_used_at).toBeNull();
    expect(await familyRefreshTokenCount(identityPool, issued.familyId)).toBe(2);
    const session = await identityPool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.sessions WHERE sid = $1`,
      [issued.sid],
    );
    expect(session.rows[0]?.revoked_at).toBeNull();
    expect(await familyRevokeReasons(identityPool, issued.familyId)).toEqual([null]);
    const audits = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.audit_log WHERE entity_id = $1`,
      [issued.familyId],
    );
    expect(audits.rows[0]?.c).toBe('0');
  });

  it('AUTH-RT-05 / AppSec 9-1: unused-token lock_timeout is retryable and changes no state', async () => {
    const accountId = await seedShopkeeper(identityPool);
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    const locker = await identityPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(`SELECT hash FROM identity.refresh_tokens WHERE hash = $1 FOR UPDATE`, [
        issued.hash,
      ]);
      const result = await store.rotate(issued.refreshToken, 'shopkeeper');
      expect(result).toEqual({ status: 'rejected', reason: 'lock_timeout' });
      await locker.query('COMMIT');
    } finally {
      locker.release();
    }
    const token = await identityPool.query<{
      rotated_at: Date | null;
      successor: string | null;
    }>(`SELECT rotated_at, successor FROM identity.refresh_tokens WHERE hash = $1`, [issued.hash]);
    expect(token.rows[0]?.rotated_at).toBeNull();
    expect(token.rows[0]?.successor).toBeNull();
    expect(await familyRefreshTokenCount(identityPool, issued.familyId)).toBe(1);
    expect(await familyRevokeReasons(identityPool, issued.familyId)).toEqual([null]);
    const audits = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.audit_log WHERE entity_id = $1`,
      [issued.familyId],
    );
    expect(audits.rows[0]?.c).toBe('0');
  });

  it('AUTH-RT-02-G1: PG negatives — after 20s, second grace, or used successor revoke', async () => {
    const store = new PgRefreshTokenStore(identityPool);

    let now = new Date('2026-10-15T00:00:00.000Z');
    const afterWindow = await store.issue(
      {
        accountId: await seedShopkeeper(identityPool),
        sid: randomUUID(),
        familyId: randomUUID(),
        typ: 'shopkeeper',
      },
      () => now,
    );
    await store.rotate(afterWindow.refreshToken, 'shopkeeper', () => now);
    now = new Date(now.getTime() + REFRESH_GRACE_MS + 1);
    expect(await store.rotate(afterWindow.refreshToken, 'shopkeeper', () => now)).toEqual({
      status: 'rejected',
      reason: 'reuse',
    });
    expectFamilyRevokedForReuse(await familyRevokeReasons(identityPool, afterWindow.familyId));

    const secondGrace = await store.issue({
      accountId: await seedShopkeeper(identityPool),
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    await store.rotate(secondGrace.refreshToken, 'shopkeeper');
    const grace = await store.rotate(secondGrace.refreshToken, 'shopkeeper');
    expect(grace.status).toBe('grace');
    expect(await store.rotate(secondGrace.refreshToken, 'shopkeeper')).toEqual({
      status: 'rejected',
      reason: 'reuse',
    });
    expectFamilyRevokedForReuse(await familyRevokeReasons(identityPool, secondGrace.familyId));

    const used = await store.issue({
      accountId: await seedShopkeeper(identityPool),
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    const first = await store.rotate(used.refreshToken, 'shopkeeper');
    expect(first.status).toBe('rotated');
    if (first.status !== 'rotated') throw new Error('expected rotate');
    await store.rotate(first.refreshToken, 'shopkeeper');
    expect(await store.rotate(used.refreshToken, 'shopkeeper')).toEqual({
      status: 'rejected',
      reason: 'reuse',
    });
    expectFamilyRevokedForReuse(await familyRevokeReasons(identityPool, used.familyId));
  });

  it('N9-3: used_at / grace_used_at / successor require rotated_at', async () => {
    const accountId = await seedShopkeeper(identityPool);
    const store = new PgRefreshTokenStore(identityPool);
    const issued = await store.issue({
      accountId,
      sid: randomUUID(),
      familyId: randomUUID(),
      typ: 'shopkeeper',
    });
    await expect(
      identityPool.query(`UPDATE identity.refresh_tokens SET used_at = now() WHERE hash = $1`, [
        issued.hash,
      ]),
    ).rejects.toThrow(/check constraint|refresh_tokens_used_at_rotated/i);
    await expect(
      identityPool.query(
        `UPDATE identity.refresh_tokens SET grace_used_at = now() WHERE hash = $1`,
        [issued.hash],
      ),
    ).rejects.toThrow(/check constraint|refresh_tokens_grace_used_at_rotated/i);
    await expect(
      identityPool.query(`UPDATE identity.refresh_tokens SET successor = $2 WHERE hash = $1`, [
        issued.hash,
        'a'.repeat(64),
      ]),
    ).rejects.toThrow(/check constraint|refresh_tokens_successor_rotated/i);
  });
});
