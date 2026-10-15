import { randomUUID } from 'node:crypto';
import type { AuditEntry, AuditWriter } from './audit.js';
import type { TenantTx } from '../db/tenant.js';

export class PgAuditWriter implements AuditWriter<TenantTx> {
  async append(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.client.query(
      `INSERT INTO platform.audit_log (
         id, at, actor_type, actor_id, actor_name, distributor_id,
         action, entity, entity_id, data, ip
       ) VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        entry.actorType,
        entry.actorId,
        entry.actorName,
        entry.distributorId,
        entry.action,
        entry.entity,
        entry.entityId,
        JSON.stringify(entry.data ?? {}),
        entry.ip,
      ],
    );
  }
}
