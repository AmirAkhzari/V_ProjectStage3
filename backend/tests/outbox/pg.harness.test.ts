import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { PgAuditWriter } from '../../src/platform/audit/auditPg.js';
import { withTenant } from '../../src/platform/db/tenant.js';
import type { EventEnvelope } from '../../src/platform/events/envelope.js';
import { PgOutboxStore, PgOutboxWriter } from '../../src/platform/events/outboxPg.js';
import { PgInboxStore } from '../../src/platform/events/inboxPg.js';
import { PgIdempotencyStore } from '../../src/platform/http/idempotencyPg.js';
import { startPostgresWithRoles, type StartedPostgresRoles } from '../helpers/containers.js';

const DIST = '11111111-1111-1111-1111-111111111111';
const DIST_B = '22222222-2222-2222-2222-222222222222';

function event(id = randomUUID()): EventEnvelope {
  return {
    id,
    type: 'platform.test',
    version: 1,
    aggregateType: 'probe',
    aggregateId: '1',
    distributorId: DIST,
    occurredAt: new Date(),
    payload: { ok: true },
  };
}

describe('Postgres outbox / inbox / audit / idempotency', () => {
  let deps: StartedPostgresRoles;
  let appPool: pg.Pool;
  let workerPool: pg.Pool;
  let ownerPool: pg.Pool;

  beforeAll(async () => {
    deps = await startPostgresWithRoles();
    appPool = new pg.Pool({ connectionString: deps.appUrl });
    workerPool = new pg.Pool({ connectionString: deps.workerUrl });
    ownerPool = new pg.Pool({ connectionString: deps.ownerUrl });
    await ownerPool.query(`
      CREATE TABLE platform.outbox_fault_probe (
        id uuid PRIMARY KEY,
        distributor_id uuid NOT NULL
      );
      GRANT INSERT, SELECT ON platform.outbox_fault_probe TO vproject_app;
    `);
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await workerPool?.end();
    await ownerPool?.end();
    await deps?.postgres.stop();
  });

  it('commits outbox and audit in the same transaction', async () => {
    const writer = new PgOutboxWriter();
    const audit = new PgAuditWriter();
    const ev = event();
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST }, async (tx) => {
      await audit.append(tx, {
        actorType: 'staff',
        actorId: 'staff-1',
        actorName: 'Staff',
        distributorId: DIST,
        action: 'probe',
        entity: 'probe',
        entityId: '1',
        data: {},
        ip: null,
      });
      await writer.publish(tx, ev);
    });
    const rows = await workerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.outbox_events WHERE id = $1`,
      [ev.id],
    );
    expect(rows.rows[0]?.c).toBe('1');
  });

  it('rolls back state, audit and outbox on a fault before commit (TXN-OUT-01)', async () => {
    const writer = new PgOutboxWriter();
    const audit = new PgAuditWriter();
    const ev = event();
    const stateId = randomUUID();
    await expect(
      withTenant(appPool, { subjectType: 'staff', distributorId: DIST }, async (tx) => {
        await tx.client.query(
          `INSERT INTO platform.outbox_fault_probe (id, distributor_id) VALUES ($1, $2)`,
          [stateId, DIST],
        );
        await audit.append(tx, {
          actorType: 'staff',
          actorId: 'staff-1',
          actorName: 'Staff',
          distributorId: DIST,
          action: 'probe',
          entity: 'probe',
          entityId: ev.id,
          data: { fault: true },
          ip: null,
        });
        await writer.publish(tx, ev);
        throw new Error('fault-before-commit');
      }),
    ).rejects.toThrow(/fault-before-commit/);
    const outbox = await workerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.outbox_events WHERE id = $1`,
      [ev.id],
    );
    const auditRows = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.audit_log WHERE entity_id = $1`,
      [ev.id],
    );
    const state = await ownerPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM platform.outbox_fault_probe WHERE id = $1`,
      [stateId],
    );
    expect(outbox.rows[0]?.c).toBe('0');
    expect(auditRows.rows[0]?.c).toBe('0');
    expect(state.rows[0]?.c).toBe('0');

    const retryId = randomUUID();
    const retryEvent = event();
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST }, async (tx) => {
      await tx.client.query(
        `INSERT INTO platform.outbox_fault_probe (id, distributor_id) VALUES ($1, $2)`,
        [retryId, DIST],
      );
      await audit.append(tx, {
        actorType: 'staff',
        actorId: 'staff-1',
        actorName: 'Staff',
        distributorId: DIST,
        action: 'probe',
        entity: 'probe',
        entityId: retryEvent.id,
        data: { retry: true },
        ip: null,
      });
      await writer.publish(tx, retryEvent);
    });
    const store = new PgOutboxStore(workerPool);
    const batch = await store.claimBatch(10, new Date());
    expect(batch.filter((r) => r.event.id === retryEvent.id)).toHaveLength(1);
  });

  it('claims unpublished rows with SKIP LOCKED and marks them published', async () => {
    const writer = new PgOutboxWriter();
    const store = new PgOutboxStore(workerPool);
    const ev = event();
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST }, async (tx) => {
      await writer.publish(tx, ev);
    });
    const batch = await store.claimBatch(10, new Date());
    expect(batch.some((r) => r.event.id === ev.id)).toBe(true);
    await store.markPublished(ev.id, new Date());
    const published = await workerPool.query<{ published_at: Date | null }>(
      `SELECT published_at FROM platform.outbox_events WHERE id = $1`,
      [ev.id],
    );
    expect(published.rows[0]?.published_at).toBeInstanceOf(Date);
  });

  it('applies an inbox effect once', async () => {
    const inbox = new PgInboxStore(workerPool);
    let count = 0;
    const id = randomUUID();
    expect(
      await inbox.runOnce('h', id, async () => {
        count += 1;
      }),
    ).toBe(true);
    expect(
      await inbox.runOnce('h', id, async () => {
        count += 1;
      }),
    ).toBe(false);
    expect(count).toBe(1);
  });

  it('does not grant the worker UPDATE on inbox or any idempotency access', async () => {
    await expect(
      workerPool.query(`UPDATE platform.inbox_processed SET processed_at = now()`),
    ).rejects.toThrow(/permission denied/i);
    await expect(workerPool.query(`SELECT 1 FROM platform.idempotency_keys`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('worker role / outbox claim (infra): claims both tenants without an HTTP scope header', async () => {
    const who = await workerPool.query<{ current_user: string }>(`SELECT current_user`);
    expect(who.rows[0]?.current_user).toBe('vproject_worker');
    const flag = await workerPool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(flag.rows[0]?.rolbypassrls).toBe(false);

    const writer = new PgOutboxWriter();
    const evA = event();
    const evB = event();
    evB.distributorId = DIST_B;
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST }, async (tx) => {
      await writer.publish(tx, evA);
    });
    await withTenant(appPool, { subjectType: 'staff', distributorId: DIST_B }, async (tx) => {
      await writer.publish(tx, evB);
    });
    const store = new PgOutboxStore(workerPool);
    const batch = await store.claimBatch(20, new Date());
    const ids = batch.map((r) => r.event.id);
    expect(ids).toEqual(expect.arrayContaining([evA.id, evB.id]));
    const guc = await workerPool.query<{ current_setting: string | null }>(
      `SELECT current_setting('app.distributor_id', true) AS current_setting`,
    );
    expect(guc.rows[0]?.current_setting ?? '').toBe('');
  });

  it('N-2: does not let vproject_app SELECT outbox payloads', async () => {
    await expect(appPool.query(`SELECT payload FROM platform.outbox_events`)).rejects.toThrow(
      /permission denied/i,
    );
    const lag = await appPool.query<{ lagged: boolean }>(
      `SELECT platform.outbox_lag_exceeded(30000) AS lagged`,
    );
    expect(lag.rows[0]?.lagged).toBe(false);
  });

  it('stores idempotency keys for the same scope/subject/key', async () => {
    const store = new PgIdempotencyStore(appPool);
    await store.put('checkout', 'sub-1', 'key-1', {
      requestHash: 'abc',
      statusCode: 200,
      response: { ok: true },
    });
    const hit = await store.get('checkout', 'sub-1', 'key-1');
    expect(hit?.statusCode).toBe(200);
    expect(hit?.requestHash).toBe('abc');
    const replay = await store.get('checkout', 'sub-1', 'key-1');
    expect(replay).toEqual(hit);
    expect(await store.get('checkout', 'sub-1', 'other-key')).toBeUndefined();
  });
});
