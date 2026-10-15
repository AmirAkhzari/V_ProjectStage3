import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import {
  BREACHED_LIST_VERSION,
  loadBreachedPasswordList,
  logBreachedListBoot,
} from '../../src/modules/identity/infra/crypto/breachedPasswords.js';
import { hashRefreshToken } from '../../src/modules/identity/infra/crypto/refreshHash.js';
import { PgRefreshTokenStore } from '../../src/modules/identity/infra/crypto/pgRefreshStore.js';
import { startPostgresWithRoles, type StartedPostgresRoles } from '../helpers/containers.js';

describe('S11b-2 crypto integration', () => {
  let deps: StartedPostgresRoles;
  let identityPool: pg.Pool;

  beforeAll(async () => {
    deps = await startPostgresWithRoles();
    identityPool = new pg.Pool({ connectionString: deps.identityUrl });
  });

  afterAll(async () => {
    await identityPool.end();
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
    if (rotated.status === 'rejected') throw new Error('expected rotate');
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
});
